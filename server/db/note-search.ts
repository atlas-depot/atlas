import { isDeepStrictEqual } from "node:util";
import { and, asc, cosineDistance, eq, inArray, sql } from "drizzle-orm";
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
        const sources = new Map<
          string,
          { revision: number; projection: ReturnType<typeof projectNotePassages> } | null
        >();
        for (let index = 0; index < rows.length && passages.length < size; index++) {
          // Load only the next ranked window, not the entire overfetch set. Shared
          // locks keep cached projections stable until this transaction commits.
          if (index % size === 0) {
            const ids = [
              ...new Set(rows.slice(index, index + size).map((row) => row.noteId)),
            ].filter((id) => !sources.has(id));
            if (ids.length) {
              const currentNotes = await tx
                .select({ id: notes.id, revision: notes.revision, content: notes.content })
                .from(notes)
                .where(and(inArray(notes.id, ids), eq(notes.ownerId, owner)))
                .orderBy(notes.id)
                .for("share");
              // Missing or inaccessible notes must not be retried in later windows.
              for (const id of ids) sources.set(id, null);
              for (const note of currentNotes) {
                sources.set(note.id, {
                  revision: note.revision,
                  projection: projectNotePassages({
                    noteId: note.id,
                    version: JSON.stringify(`${note.id}:${note.revision}`),
                    content: note.content,
                  }),
                });
              }
            }
          }
          const row = rows[index];
          const note = sources.get(row.noteId);
          if (!note || note.revision !== row.revision) continue;
          const source = notePassageSourceSchema.safeParse(row.source);
          const current = note.projection;
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
