import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { conversationIdSchema, conversationTextSchema } from "../../shared/conversations.ts";
import type { openDatabase } from "./connection.ts";
import { enqueueTurnCleanup } from "./conversation-cleanup.ts";
import { readConversationMessage } from "./conversation-messages.ts";
import {
  conversationPayloadHash,
  lockOwnedConversation,
  finalizeConversationTurn,
  publishConversationAnswer,
  type ConversationTransaction,
} from "./conversation-publication.ts";
import {
  conversations,
  conversationMessages,
  conversationTurns,
  conversationTurnInputs,
} from "./conversation-schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
const inputSchema = z.strictObject({
  text: conversationTextSchema.refine((text) => text.trim().length > 0),
  policy: z.enum(["queue", "steer"]).default("queue"),
});
const attemptSchema = z
  .strictObject({
    inputIds: z.array(conversationIdSchema).min(1),
    retryOfId: conversationIdSchema.optional(),
  })
  .refine((value) => new Set(value.inputIds).size === value.inputIds.length);

async function turnInputs(tx: ConversationTransaction, turnId: string) {
  return (
    await tx
      .select()
      .from(conversationTurnInputs)
      .where(eq(conversationTurnInputs.turnId, turnId))
      .orderBy(asc(conversationTurnInputs.ordinal))
  ).map((row) => row.messageId);
}

/** Internal persistence only. Callers execute models after durable admission/runtime binding. */
export function createConversationTurns(db: Database) {
  return {
    async acceptInput(
      owner: string,
      conversationId: string,
      operationId: string,
      value: z.input<typeof inputSchema>,
    ) {
      const input = inputSchema.parse(value);
      const operation = conversationIdSchema.parse(operationId);
      const payloadHash = conversationPayloadHash([input.text, input.policy]);
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        const [existing] = await tx
          .select()
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, parent.id),
              eq(conversationMessages.operationId, operation),
            ),
          );
        if (existing)
          return existing.role === "user" && existing.payloadHash === payloadHash
            ? {
                status: "saved" as const,
                value: (await readConversationMessage(tx, parent.id, existing.id))!,
              }
            : { status: "conflict" as const };
        const [message] = await tx
          .insert(conversationMessages)
          .values({
            conversationId: parent.id,
            operationId: operation,
            payloadHash,
            sequence: parent.nextSequence,
            role: "user",
            deliveryPolicy: input.policy,
            text: input.text,
          })
          .returning();
        await tx
          .update(conversations)
          .set({ nextSequence: parent.nextSequence + 1, updatedAt: new Date().toISOString() })
          .where(eq(conversations.id, parent.id));
        return {
          status: "saved" as const,
          value: (await readConversationMessage(tx, parent.id, message!.id))!,
        };
      });
    },

    async startAttempt(
      owner: string,
      conversationId: string,
      operationId: string,
      value: z.input<typeof attemptSchema>,
    ) {
      const input = attemptSchema.parse(value);
      const operation = conversationIdSchema.parse(operationId);
      const payloadHash = conversationPayloadHash([input.inputIds, input.retryOfId ?? null]);
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        const [existing] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.conversationId, parent.id),
              eq(conversationTurns.operationId, operation),
            ),
          );
        if (existing)
          return existing.payloadHash === payloadHash
            ? { status: "saved" as const, value: existing }
            : { status: "conflict" as const };
        if (parent.queuePaused) return { status: "paused" as const };
        const [running] = await tx
          .select({ id: conversationTurns.id })
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.conversationId, parent.id),
              eq(conversationTurns.status, "running"),
            ),
          );
        if (running) return { status: "busy" as const, turnId: running.id };
        const messages = await tx
          .select()
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, parent.id),
              inArray(conversationMessages.id, input.inputIds),
            ),
          )
          .orderBy(asc(conversationMessages.sequence));
        if (
          messages.length !== input.inputIds.length ||
          messages.some(
            (message, index) => message.role !== "user" || message.id !== input.inputIds[index],
          )
        )
          return { status: "conflict" as const };
        if (messages.some((message) => message.deliveryPolicy === "steer"))
          return { status: "policy_unsupported" as const };
        if (input.retryOfId) {
          const [original] = await tx
            .select()
            .from(conversationTurns)
            .where(
              and(
                eq(conversationTurns.id, input.retryOfId),
                eq(conversationTurns.conversationId, parent.id),
              ),
            );
          if (
            !original ||
            original.status !== "incomplete" ||
            JSON.stringify(await turnInputs(tx, original.id)) !== JSON.stringify(input.inputIds)
          )
            return { status: "conflict" as const };
        } else {
          const consumed = await tx
            .select()
            .from(conversationTurnInputs)
            .where(
              and(
                eq(conversationTurnInputs.conversationId, parent.id),
                inArray(conversationTurnInputs.messageId, input.inputIds),
              ),
            );
          if (consumed.length) return { status: "conflict" as const };
        }
        const [turn] = await tx
          .insert(conversationTurns)
          .values({
            conversationId: parent.id,
            operationId: operation,
            payloadHash,
            status: "running",
            runningText: "",
            retryOfId: input.retryOfId,
          })
          .returning();
        await tx.insert(conversationTurnInputs).values(
          input.inputIds.map((messageId, ordinal) => ({
            conversationId: parent.id,
            turnId: turn!.id,
            messageId,
            ordinal,
          })),
        );
        return { status: "saved" as const, value: turn! };
      });
    },

    async checkpoint(
      owner: string,
      conversationId: string,
      turnId: string,
      expectedVersion: number,
      text: string,
    ) {
      const id = conversationIdSchema.parse(turnId);
      z.number().int().min(0).max(2_147_483_646).parse(expectedVersion);
      conversationTextSchema.parse(text);
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(eq(conversationTurns.id, id), eq(conversationTurns.conversationId, parent.id)),
          );
        if (!turn) return { status: "not_found" as const };
        if (turn.status !== "running") return { status: "conflict" as const };
        if (turn.checkpointVersion === expectedVersion + 1 && turn.runningText === text)
          return { status: "saved" as const, version: turn.checkpointVersion };
        if (turn.checkpointVersion !== expectedVersion) return { status: "conflict" as const };
        await tx
          .update(conversationTurns)
          .set({
            runningText: text,
            checkpointVersion: expectedVersion + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(conversationTurns.id, id));
        return { status: "saved" as const, version: expectedVersion + 1 };
      });
    },

    finalize: finalizeConversationTurn(db),

    async stop(owner: string, conversationId: string) {
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.conversationId, parent.id),
              eq(conversationTurns.status, "running"),
            ),
          );
        const message = turn
          ? await publishConversationAnswer(tx, parent, turn, {
              status: "incomplete",
              reason: "cancelled",
              text: turn.runningText ?? "",
              citations: [],
              expectedVersion: turn.checkpointVersion,
            })
          : undefined;
        if (turn) await enqueueTurnCleanup(tx, owner, turn);
        await tx
          .update(conversations)
          .set({ queuePaused: true, updatedAt: new Date().toISOString() })
          .where(eq(conversations.id, parent.id));
        return { status: "paused" as const, message };
      });
    },

    async resume(owner: string, conversationId: string) {
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        await tx
          .update(conversations)
          .set({ queuePaused: false, updatedAt: new Date().toISOString() })
          .where(eq(conversations.id, parent.id));
        return { status: "resumed" as const };
      });
    },
  };
}
