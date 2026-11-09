import { eq, sql } from "drizzle-orm";
import type { openDatabase } from "./connection.ts";
import { noteIndexes, noteIndexIntents, type notes } from "./schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Call inside the note write transaction, after inserting or locking the note. */
export async function requestNoteIndex(
  tx: Transaction,
  note: Pick<typeof notes.$inferSelect, "id" | "revision">,
) {
  // Cascading passage deletion happens in the same transaction as the source edit.
  await tx.delete(noteIndexes).where(eq(noteIndexes.noteId, note.id));
  await tx
    .insert(noteIndexIntents)
    .values({ noteId: note.id, revision: note.revision })
    .onConflictDoUpdate({
      target: noteIndexIntents.noteId,
      set: { revision: note.revision, requestedAt: sql`clock_timestamp()` },
    });
}
