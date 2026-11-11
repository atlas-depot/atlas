import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm";
import { z } from "zod";
import {
  conversationIdSchema,
  conversationOperationKeySchema,
  conversationPageSchema,
  conversationReadSchema,
  conversationSchema,
  createConversationSchema,
  type ConversationPage,
} from "../../shared/conversations.ts";
import type { openDatabase } from "./connection.ts";
import {
  conversationCreateRequests,
  conversationMessages,
  conversations,
  conversationTurnInputs,
  conversationTurns,
} from "./conversation-schema.ts";
import { enqueueConversationCleanup } from "./conversation-cleanup.ts";
import {
  encodeConversationCursor,
  parseConversationCursor,
  parseMessageCursor,
} from "./conversation-cursors.ts";
import { conversationTimestamp, serializeConversationMessages } from "./conversation-messages.ts";
export { readConversationMessage } from "./conversation-messages.ts";

type Database = ReturnType<typeof openDatabase>["db"];
const ownerSchema = z.string().min(1);
const publicConversation = (row: typeof conversations.$inferSelect) =>
  conversationSchema.parse({
    id: row.id,
    queuePaused: row.queuePaused,
    createdAt: conversationTimestamp(row.createdAt),
    updatedAt: conversationTimestamp(row.updatedAt),
  });
const owned = (owner: string, id: string) =>
  and(
    eq(conversations.ownerId, ownerSchema.parse(owner)),
    eq(conversations.id, conversationIdSchema.parse(id)),
  );

export function createConversationStore(db: Database) {
  return {
    async createIdempotent(owner: string, key: string, input: Record<string, never>) {
      ownerSchema.parse(owner);
      const normalizedKey = conversationOperationKeySchema.parse(key);
      const payloadHash = createHash("sha256")
        .update(JSON.stringify(createConversationSchema.parse(input)))
        .digest("hex");
      return db.transaction(async (tx) => {
        const id = randomUUID();
        const inserted = await tx
          .insert(conversationCreateRequests)
          .values({ ownerId: owner, key: normalizedKey, payloadHash, conversationId: id })
          .onConflictDoNothing()
          .returning();
        if (inserted.length) {
          const [row] = await tx.insert(conversations).values({ id, ownerId: owner }).returning();
          return { status: "saved" as const, value: publicConversation(row!) };
        }
        const [receipt] = await tx
          .select()
          .from(conversationCreateRequests)
          .where(
            and(
              eq(conversationCreateRequests.ownerId, owner),
              eq(conversationCreateRequests.key, normalizedKey),
            ),
          );
        if (!receipt || receipt.payloadHash !== payloadHash) return { status: "conflict" as const };
        const [row] = await tx
          .select()
          .from(conversations)
          .where(owned(owner, receipt.conversationId))
          .for("share");
        return row
          ? { status: "saved" as const, value: publicConversation(row) }
          : { status: "conflict" as const };
      });
    },
    async list(owner: string, input: ConversationPage) {
      ownerSchema.parse(owner);
      const page = conversationPageSchema.parse(input);
      const cursor = parseConversationCursor(page.cursor);
      const boundary =
        cursor &&
        or(
          lt(conversations.createdAt, cursor.createdAt),
          and(eq(conversations.createdAt, cursor.createdAt), lt(conversations.id, cursor.id)),
        );
      const rows = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.ownerId, owner), boundary))
        .orderBy(desc(conversations.createdAt), desc(conversations.id))
        .limit(page.limit + 1);
      const selected = rows.slice(0, page.limit);
      const last = selected.at(-1);
      return {
        conversations: selected.map(publicConversation),
        nextCursor:
          rows.length > page.limit && last
            ? encodeConversationCursor({
                id: last.id,
                createdAt: conversationTimestamp(last.createdAt),
              })
            : null,
      };
    },
    async read(owner: string, id: string) {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(conversations).where(owned(owner, id)).for("share");
        if (!row) return undefined;
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(eq(conversationTurns.conversationId, id), eq(conversationTurns.status, "running")),
          );
        const inputs = turn
          ? await tx
              .select()
              .from(conversationTurnInputs)
              .where(eq(conversationTurnInputs.turnId, turn.id))
              .orderBy(asc(conversationTurnInputs.ordinal))
          : [];
        const [latest] = await tx
          .select({ id: conversationTurns.id, recovery: conversationTurns.contextRecovery })
          .from(conversationTurns)
          .where(eq(conversationTurns.conversationId, id))
          .orderBy(desc(conversationTurns.createdAt), desc(conversationTurns.id))
          .limit(1);
        return conversationReadSchema.parse({
          conversation: publicConversation(row),
          recovery: latest?.recovery ? { turnId: latest.id, reason: latest.recovery } : null,
          activeTurn: turn
            ? {
                id: turn.id,
                status: "running",
                text: turn.runningText ?? "",
                checkpointVersion: turn.checkpointVersion,
                inputIds: inputs.map((input) => input.messageId),
              }
            : null,
        });
      });
    },
    async messages(owner: string, id: string, input: ConversationPage) {
      const page = conversationPageSchema.parse(input);
      const after = parseMessageCursor(page.cursor);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(owned(owner, id))
          .for("share");
        if (!row) return undefined;
        const rows = await tx
          .select()
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, id),
              gt(conversationMessages.sequence, after),
            ),
          )
          .orderBy(asc(conversationMessages.sequence))
          .limit(page.limit + 1);
        const selected = rows.slice(0, page.limit);
        return {
          messages: await serializeConversationMessages(tx, selected),
          nextCursor: rows.length > page.limit ? String(selected.at(-1)!.sequence) : null,
        };
      });
    },
    async delete(owner: string, id: string) {
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(conversations).where(owned(owner, id)).for("update");
        if (!row) return { status: "not_found" as const };
        await enqueueConversationCleanup(tx, owner, id);
        await tx.delete(conversations).where(owned(owner, id));
        return { status: "deleted" as const };
      });
    },
  };
}
