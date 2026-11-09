import type { openDatabase } from "./connection.ts";
import { notes } from "./schema.ts";
import { requestNoteIndex } from "./note-index-intents.ts";

/** Synthetic owners intentionally do not identify real WorkOS accounts. */
const sampleNotes = [
  {
    id: "3d3a1a11-1111-4111-8111-111111111111",
    ownerId: "synthetic-seed-alex",
    title: "Sample project notes",
    content:
      "# Sample project\n\n- Draft a plan\n- Review the plan\n\nThis is synthetic development data.",
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  },
  {
    id: "3d3a1a22-2222-4222-8222-222222222222",
    ownerId: "synthetic-seed-sam",
    title: "Sample private note",
    content: "# Separate account\n\nThis synthetic note belongs to a different development owner.",
    createdAt: "2026-10-02T09:00:00.000Z",
    updatedAt: "2026-10-02T09:00:00.000Z",
  },
];

export async function seedNotes(db: ReturnType<typeof openDatabase>["db"]) {
  // Fixed identities make reruns safe. Existing content and revisions are never reset.
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(notes)
      .values(sampleNotes)
      .onConflictDoNothing({ target: notes.id })
      .returning({ id: notes.id, revision: notes.revision });
    for (const note of inserted) await requestNoteIndex(tx, note);
    return inserted.length;
  });
}
