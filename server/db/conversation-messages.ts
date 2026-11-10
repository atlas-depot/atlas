import { and, asc, eq, inArray } from "drizzle-orm";
import { conversationMessageSchema, type ConversationMessage } from "../../shared/conversations.ts";
import { notes } from "./schema.ts";
import { noteTag } from "./notes.ts";
import type { openDatabase } from "./connection.ts";
import {
  conversationCitations,
  conversationMessages,
  conversationTurnInputs,
  conversationTurns,
} from "./conversation-schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
export type ConversationReader = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
export const conversationTimestamp = (value: string) =>
  value.replace(" ", "T").replace(/\+00(?::00)?$/, "Z");

/** Serializes only public columns. Replays reread citations so note deletion redactions take effect. */
export async function serializeConversationMessages(
  reader: ConversationReader,
  rows: (typeof conversationMessages.$inferSelect)[],
): Promise<ConversationMessage[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const turnIds = rows.flatMap((row) => (row.turnId ? [row.turnId] : []));
  const citations = await reader
    .select()
    .from(conversationCitations)
    .where(inArray(conversationCitations.messageId, ids))
    .orderBy(asc(conversationCitations.ordinal));
  const noteIds = [...new Set(citations.map((citation) => citation.noteId))];
  const currentNotes = noteIds.length
    ? await reader
        .select({ id: notes.id, revision: notes.revision })
        .from(notes)
        .where(inArray(notes.id, noteIds))
    : [];
  const versions = new Map(currentNotes.map((note) => [note.id, noteTag(note.id, note.revision)]));
  const turns = turnIds.length
    ? await reader.select().from(conversationTurns).where(inArray(conversationTurns.id, turnIds))
    : [];
  const inputs = turnIds.length
    ? await reader
        .select()
        .from(conversationTurnInputs)
        .where(inArray(conversationTurnInputs.turnId, turnIds))
        .orderBy(asc(conversationTurnInputs.ordinal))
    : [];
  return rows.map((row) => {
    const common = {
      id: row.id,
      sequence: row.sequence,
      text: row.text,
      createdAt: conversationTimestamp(row.createdAt),
    };
    if (row.role === "user")
      return conversationMessageSchema.parse({
        ...common,
        role: "user",
        deliveryPolicy: row.deliveryPolicy,
      });
    const turn = turns.find((candidate) => candidate.id === row.turnId);
    return conversationMessageSchema.parse({
      ...common,
      role: "assistant",
      turnId: row.turnId,
      status: turn?.status,
      reason: turn?.reason,
      inputIds: inputs
        .filter((input) => input.turnId === row.turnId)
        .map((input) => input.messageId),
      citations: citations
        .filter((citation) => citation.messageId === row.id)
        .map(({ source, excerpt, deleted, noteId }) => {
          const missing = deleted || !versions.has(noteId);
          return {
            source,
            excerpt: missing ? null : excerpt,
            deleted: missing,
            stale: !missing && versions.get(noteId) !== source.version,
          };
        }),
    });
  });
}

/** Caller must establish ownership and hold the conversation lock for mutation/replay. */
export async function readConversationMessage(
  reader: ConversationReader,
  conversationId: string,
  messageId: string,
) {
  const rows = await reader
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.id, messageId),
      ),
    );
  return (await serializeConversationMessages(reader, rows))[0];
}
