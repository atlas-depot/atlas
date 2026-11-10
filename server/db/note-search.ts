import { isDeepStrictEqual } from "node:util";
import { and, asc, cosineDistance, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { EMBEDDING_FINGERPRINT, embeddingVectorSchema } from "../../shared/embedding.ts";
import { notePassageSourceSchema, type NotePassage } from "../../shared/passages.ts";
import { projectNotePassages } from "../passages.ts";
import type { openDatabase } from "./connection.ts";
import { noteIndexes, noteIndexIntents, notePassages, notes } from "./schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
const ownerSchema = z.string().min(1);
const limitSchema = z.number().int().min(1).max(10);

/** Ranked candidates are evidence locations, not a claim that the question is answerable. */
export function createNoteSearchStore(db: Database) {
  return {
    async candidates(
      ownerId: string,
      vector: number[],
      limit = 5,
    ): Promise<{
      passages: Array<NotePassage & { score: number }>;
      coverage: { ready: number; pending: number; failed: number };
    }> {
      const owner = ownerSchema.parse(ownerId);
      const queryVector = embeddingVectorSchema.parse(vector);
      const size = limitSchema.parse(limit);
      return db.transaction(async (tx) => {
        const distance = cosineDistance(notePassages.embedding, queryVector);
        const rows = await tx
          .select({
            noteId: notePassages.noteId,
            revision: noteIndexes.revision,
            text: notePassages.text,
            source: notePassages.source,
            distance,
          })
          .from(notePassages)
          .innerJoin(noteIndexes, eq(notePassages.noteId, noteIndexes.noteId))
          .innerJoin(
            notes,
            and(
              eq(notes.id, noteIndexes.noteId),
              eq(notes.ownerId, owner),
              eq(notes.revision, noteIndexes.revision),
            ),
          )
          .where(eq(noteIndexes.fingerprint, EMBEDDING_FINGERPRINT))
          .orderBy(asc(distance), notePassages.noteId, notePassages.ordinal)
          .limit(size * 10);

        const passages: Array<NotePassage & { score: number }> = [];
        for (const row of rows) {
          if (passages.length === size) break;
          // A source writer locks the same note before edit/deletion. This shared lock
          // keeps the validated source stable until the search transaction commits.
          const [note] = await tx
            .select({ revision: notes.revision, content: notes.content })
            .from(notes)
            .where(and(eq(notes.id, row.noteId), eq(notes.ownerId, owner)))
            .for("share");
          if (!note || note.revision !== row.revision) continue;
          const source = notePassageSourceSchema.safeParse(row.source);
          const current = projectNotePassages({
            noteId: row.noteId,
            version: JSON.stringify(`${row.noteId}:${note.revision}`),
            content: note.content,
          });
          const measuredDistance = Number(row.distance);
          if (
            !source.success ||
            current.status !== "complete" ||
            !Number.isFinite(measuredDistance)
          )
            continue;
          if (
            !current.passages.some(
              (passage) =>
                passage.text === row.text && isDeepStrictEqual(passage.source, source.data),
            )
          )
            continue;
          passages.push({ text: row.text, source: source.data, score: 1 - measuredDistance });
        }
        const [counts] = await tx
          .select({
            ready: sql<number>`count(*) filter (where ${noteIndexes.noteId} is not null)`,
            failed: sql<number>`count(*) filter (where ${noteIndexes.noteId} is null and ${noteIndexIntents.failureCode} is not null)`,
            pending: sql<number>`count(*) filter (where ${noteIndexes.noteId} is null and ${noteIndexIntents.failureCode} is null)`,
          })
          .from(notes)
          .leftJoin(
            noteIndexes,
            and(
              eq(noteIndexes.noteId, notes.id),
              eq(noteIndexes.revision, notes.revision),
              eq(noteIndexes.fingerprint, EMBEDDING_FINGERPRINT),
            ),
          )
          .leftJoin(
            noteIndexIntents,
            and(
              eq(noteIndexIntents.noteId, notes.id),
              eq(noteIndexIntents.revision, notes.revision),
              eq(noteIndexIntents.fingerprint, EMBEDDING_FINGERPRINT),
            ),
          )
          .where(eq(notes.ownerId, owner));
        return {
          passages,
          coverage: {
            ready: Number(counts.ready),
            pending: Number(counts.pending),
            failed: Number(counts.failed),
          },
        };
      });
    },
  };
}
