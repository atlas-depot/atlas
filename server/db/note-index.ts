import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { EMBEDDING_FINGERPRINT, embeddingVectorSchema } from "../../shared/embedding.ts";
import { notePassageProjectionSchema } from "../../shared/passages.ts";
import { noteIdSchema } from "../../shared/notes.ts";
import type { openDatabase } from "./connection.ts";
import { noteIndexes, noteIndexIntents, notePassages, notes } from "./schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
const publicationSchema = z
  .strictObject({
    noteId: noteIdSchema,
    revision: z.number().int().positive().max(2_147_483_647),
    fingerprint: z.literal(EMBEDDING_FINGERPRINT),
    projection: notePassageProjectionSchema.refine(
      (value) => value.status === "complete" || value.status === "empty",
      "Only complete or empty projections can be published.",
    ),
    embeddings: z.array(embeddingVectorSchema).max(1_000),
  })
  .superRefine((value, ctx) => {
    if (value.projection.passages.length !== value.embeddings.length) {
      ctx.addIssue({ code: "custom", message: "Each passage requires one embedding." });
    }
    const version = JSON.stringify(`${value.noteId}:${value.revision}`);
    if (
      value.projection.passages.some(
        ({ source }) => source.noteId !== value.noteId || source.version !== version,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Passages must reference the indexed note revision.",
      });
    }
  });

/** Service-only publication boundary. ownerId must come from a verified job/source identity. */
export function createNoteIndexStore(db: Database) {
  return {
    async publish(
      ownerId: string,
      input: unknown,
    ): Promise<"published" | "already_ready" | "stale" | "unavailable"> {
      const owner = z.string().min(1).parse(ownerId);
      const data = publicationSchema.parse(input);
      return db.transaction(async (tx) => {
        // Source writers take this same lock before invalidating or removing derived content.
        const [note] = await tx
          .select()
          .from(notes)
          .where(and(eq(notes.id, data.noteId), eq(notes.ownerId, owner)))
          .for("update");
        if (!note) return "unavailable";
        if (note.revision !== data.revision) return "stale";
        const [existing] = await tx
          .select()
          .from(noteIndexes)
          .where(eq(noteIndexes.noteId, note.id));
        if (existing?.revision === data.revision && existing.fingerprint === data.fingerprint) {
          return "already_ready";
        }
        const [intent] = await tx
          .select()
          .from(noteIndexIntents)
          .where(eq(noteIndexIntents.noteId, note.id));
        if (intent?.revision !== data.revision) return "stale";
        await tx.delete(noteIndexes).where(eq(noteIndexes.noteId, note.id));
        await tx
          .insert(noteIndexes)
          .values({ noteId: note.id, revision: data.revision, fingerprint: data.fingerprint });
        // Bound statement size even when a projection contains the maximum 1,000 passages.
        for (let start = 0; start < data.projection.passages.length; start += 50) {
          await tx.insert(notePassages).values(
            data.projection.passages.slice(start, start + 50).map((passage, offset) => ({
              noteId: note.id,
              ordinal: start + offset,
              text: passage.text,
              source: passage.source,
              embedding: data.embeddings[start + offset],
            })),
          );
        }
        await tx
          .delete(noteIndexIntents)
          .where(
            and(eq(noteIndexIntents.noteId, note.id), eq(noteIndexIntents.revision, data.revision)),
          );
        return "published";
      });
    },

    async readCurrent(ownerId: string, noteId: string) {
      const owner = z.string().min(1).parse(ownerId);
      const id = noteIdSchema.parse(noteId);
      return db.transaction(async (tx) => {
        // Keep the source stable across metadata and passage reads, including an empty index.
        const [note] = await tx
          .select({ revision: notes.revision })
          .from(notes)
          .where(and(eq(notes.id, id), eq(notes.ownerId, owner)))
          .for("share");
        if (!note) return undefined;
        const [index] = await tx
          .select()
          .from(noteIndexes)
          .where(
            and(
              eq(noteIndexes.noteId, id),
              eq(noteIndexes.revision, note.revision),
              eq(noteIndexes.fingerprint, EMBEDDING_FINGERPRINT),
            ),
          );
        if (!index) return undefined;
        const passages = await tx
          .select({
            text: notePassages.text,
            source: notePassages.source,
            embedding: notePassages.embedding,
          })
          .from(notePassages)
          .where(eq(notePassages.noteId, id))
          .orderBy(notePassages.ordinal);
        return { revision: index.revision, fingerprint: index.fingerprint, passages };
      });
    },
  };
}
