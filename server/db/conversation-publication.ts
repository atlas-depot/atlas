import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  conversationCitationInputsSchema,
  conversationIdSchema,
  conversationTextSchema,
} from "../../shared/conversations.ts";
import type { openDatabase } from "./connection.ts";
import { enqueueTurnCleanup } from "./conversation-cleanup.ts";
import { readConversationMessage } from "./conversation-messages.ts";
import {
  conversationCitations,
  conversationMessages,
  conversations,
  conversationTurns,
} from "./conversation-schema.ts";
import { notes } from "./schema.ts";
import { sourceDependenciesSchema, mergeDependencies } from "../conversation-context.ts";
import { conversationContexts } from "./conversation-schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
export type ConversationTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export const conversationPayloadHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function lockOwnedConversation(
  tx: ConversationTransaction,
  owner: string,
  id: string,
) {
  z.string().min(1).parse(owner);
  const [row] = await tx
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationIdSchema.parse(id)), eq(conversations.ownerId, owner)),
    )
    .for("update");
  return row;
}

const finalizationSchema = z
  .strictObject({
    status: z.enum(["completed", "no-support", "incomplete"]),
    reason: z.enum(["failed", "cancelled"]).optional(),
    text: conversationTextSchema,
    citations: conversationCitationInputsSchema.refine((citations) =>
      citations.every((citation) => !citation.deleted),
    ),
    expectedVersion: z.number().int().nonnegative(),
    sourceDependencies: sourceDependenciesSchema.default([]),
    provenanceComplete: z.boolean().default(false),
  })
  .refine((value) =>
    value.status === "incomplete"
      ? value.reason !== undefined && value.citations.length === 0
      : value.reason === undefined &&
        value.text.trim().length > 0 &&
        (value.status === "completed" ? value.citations.length > 0 : value.citations.length === 0),
  );
type Finalization = z.input<typeof finalizationSchema>;

/** Caller owns the parent lock and, for citations, all referenced live note locks. */
export async function publishConversationAnswer(
  tx: ConversationTransaction,
  parent: typeof conversations.$inferSelect,
  turn: typeof conversationTurns.$inferSelect,
  input: Finalization,
) {
  const [message] = await tx
    .insert(conversationMessages)
    .values({
      conversationId: parent.id,
      operationId: randomUUID(),
      payloadHash: conversationPayloadHash(input),
      sequence: parent.nextSequence,
      role: "assistant",
      turnId: turn.id,
      text: input.text,
    })
    .returning();
  if (input.citations.length)
    await tx.insert(conversationCitations).values(
      input.citations.map((citation, ordinal) => ({
        conversationId: parent.id,
        messageId: message!.id,
        ordinal,
        noteId: citation.source.noteId,
        source: citation.source,
        excerpt: citation.excerpt,
        deleted: false,
      })),
    );
  await tx
    .update(conversationTurns)
    .set({
      status: input.status,
      reason: input.reason ?? null,
      runningText: null,
      sourceDependencies: mergeDependencies(
        turn.sourceDependencies,
        input.sourceDependencies ?? [],
      ),
      provenanceComplete: input.provenanceComplete ?? false,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(conversationTurns.id, turn.id));
  await tx
    .update(conversations)
    .set({ nextSequence: parent.nextSequence + 1, updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, parent.id));
  // Only running attempts need a replayable prompt snapshot. Lineage stays on the turn,
  // and the replaceable summary checkpoint is independent of this transient content.
  await tx.delete(conversationContexts).where(eq(conversationContexts.turnId, turn.id));
  return (await readConversationMessage(tx, parent.id, message!.id))!;
}

export function finalizeConversationTurn(db: ReturnType<typeof openDatabase>["db"]) {
  return async (owner: string, conversationId: string, turnId: string, value: Finalization) => {
    const input = finalizationSchema.parse(value);
    const id = conversationIdSchema.parse(turnId);
    return db.transaction(async (tx) => {
      const [snapshot] = await tx
        .select({ sources: conversationTurns.sourceDependencies })
        .from(conversationTurns)
        .innerJoin(conversations, eq(conversations.id, conversationTurns.conversationId))
        .where(
          and(
            eq(conversationTurns.id, id),
            eq(conversations.id, conversationId),
            eq(conversations.ownerId, owner),
          ),
        );
      const dependencies = mergeDependencies(snapshot?.sources ?? [], input.sourceDependencies);
      // Notes precede the conversation lock, matching note deletion/redaction order.
      let sourcesAvailable = true;
      const sourceIds = [
        ...new Set([
          ...input.citations.map((citation) => citation.source.noteId.toLowerCase()),
          ...dependencies.map((source) => source.noteId),
        ]),
      ].sort();
      for (const noteId of sourceIds) {
        const [note] = await tx
          .select({ id: notes.id })
          .from(notes)
          .where(and(eq(notes.id, noteId), eq(notes.ownerId, owner)))
          .for("share");
        if (!note) sourcesAvailable = false;
      }
      const parent = await lockOwnedConversation(tx, owner, conversationId);
      if (!parent) return { status: "not_found" as const };
      const [turn] = await tx
        .select()
        .from(conversationTurns)
        .where(and(eq(conversationTurns.id, id), eq(conversationTurns.conversationId, parent.id)));
      if (!turn) return { status: "not_found" as const };
      if (turn.status !== "running") {
        const [message] = await tx
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.turnId, turn.id));
        return message?.payloadHash === conversationPayloadHash(input)
          ? {
              status: "saved" as const,
              value: (await readConversationMessage(tx, parent.id, message.id))!,
            }
          : { status: "conflict" as const };
      }
      if (turn.checkpointVersion !== input.expectedVersion) return { status: "conflict" as const };
      if (
        turn.sourceDependencies.some(
          (source) =>
            !dependencies.some(
              (locked) => locked.noteId === source.noteId && locked.version === source.version,
            ),
        )
      )
        return { status: "conflict" as const };
      const [context] = await tx
        .select({ state: conversationContexts.state })
        .from(conversationContexts)
        .where(eq(conversationContexts.turnId, turn.id));
      if (context?.state === "recovery") sourcesAvailable = false;
      if (!sourcesAvailable) {
        await tx
          .update(conversationTurns)
          .set({
            contextRecovery: sql`coalesce(${conversationTurns.contextRecovery}, 'source_changed')`,
          })
          .where(eq(conversationTurns.id, turn.id));
        // Recovery pauses the queue like Stop, so it stays visible until the user acts.
        await tx
          .update(conversations)
          .set({ queuePaused: true })
          .where(eq(conversations.id, parent.id));
        await publishConversationAnswer(tx, parent, turn, {
          status: "incomplete",
          reason: "failed",
          text: "",
          citations: [],
          expectedVersion: turn.checkpointVersion,
        });
        await enqueueTurnCleanup(tx, owner, turn);
        return { status: "source_unavailable" as const };
      }
      const message = await publishConversationAnswer(tx, parent, turn, input);
      // Every terminal attempt leaves a runtime session that must be retired.
      await enqueueTurnCleanup(tx, owner, turn);
      return { status: "saved" as const, value: message };
    });
  };
}
