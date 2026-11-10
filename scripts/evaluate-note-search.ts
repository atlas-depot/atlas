import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createNoteEmbedder } from "../agents/organizer/embeddings.ts";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_FINGERPRINT,
  EMBEDDING_MODEL,
  encodeSearchQuery,
} from "../shared/embedding.ts";
import { projectNotePassages } from "../server/passages.ts";

const fixtureSchema = z.strictObject({
  description: z.string(),
  notes: z.array(z.strictObject({ label: z.string(), content: z.string() })),
  longNote: z.strictObject({
    label: z.string(),
    repeat: z.number().int().min(1).max(100),
    filler: z.string(),
    target: z.string(),
  }),
  queries: z.array(z.strictObject({ text: z.string(), expected: z.string().nullable() })),
});

const fixture = fixtureSchema.parse(
  JSON.parse(
    await readFile(new URL("../fixtures/search/semantic-evaluation.json", import.meta.url), "utf8"),
  ),
);
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey)
  throw new Error("OPENROUTER_API_KEY is required for the separately authorized live evaluation.");

const notes = [
  ...fixture.notes,
  {
    label: fixture.longNote.label,
    content: `${fixture.longNote.filler.repeat(fixture.longNote.repeat)}\n\n${fixture.longNote.target}`,
  },
];
const passages = notes.flatMap(({ label, content }) => {
  const noteId = randomUUID();
  const projection = projectNotePassages({
    noteId,
    version: JSON.stringify(`${noteId}:1`),
    content,
  });
  if (projection.status !== "complete") throw new Error(`Invalid evaluation note ${label}.`);
  return projection.passages.map((passage) => ({ label, text: passage.text }));
});
if (passages.length + fixture.queries.length > 100)
  throw new Error("Evaluation exceeds input cap.");

let tokens = 0;
const embed = createNoteEmbedder({
  apiKey,
  onUsage: (count) => {
    tokens += count;
  },
});
const passageVectors = await embed(passages.map(({ text }) => text));
const queryVectors = await embed(fixture.queries.map(({ text }) => encodeSearchQuery(text)));
const similarity = (left: number[], right: number[]) => {
  let dot = 0,
    leftNorm = 0,
    rightNorm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
};
const results = fixture.queries.map(({ text, expected }, queryIndex) => {
  const ranked = passages
    .map((passage, index) => ({
      ...passage,
      score: similarity(queryVectors[queryIndex], passageVectors[index]),
    }))
    .sort((a, b) => b.score - a.score);
  const foundIndex =
    expected === null
      ? -1
      : ranked.findIndex(
          (item) =>
            item.label === expected &&
            (expected !== fixture.longNote.label || item.text.includes(fixture.longNote.target)),
        );
  const expectedRank = expected === null ? null : foundIndex < 0 ? null : foundIndex + 1;
  return {
    query: text,
    expected,
    expectedRank,
    top: ranked.slice(0, 5).map(({ label, score }) => ({ label, score })),
  };
});
const answerable = results.filter((item) => item.expected !== null);
console.log(
  JSON.stringify(
    {
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      fingerprint: EMBEDDING_FINGERPRINT,
      noteCount: notes.length,
      passageCount: passages.length,
      queryCount: fixture.queries.length,
      top1Hits: answerable.filter((item) => item.expectedRank === 1).length,
      top5Hits: answerable.filter((item) => item.expectedRank !== null && item.expectedRank <= 5)
        .length,
      answerableCount: answerable.length,
      providerReportedInputTokens: tokens,
      // Listed 10 November 2026: https://openrouter.ai/qwen/qwen3-embedding-8b/pricing
      estimatedUsdAtListedRate: Number(((tokens * 0.01) / 1_000_000).toFixed(8)),
      results,
    },
    null,
    2,
  ),
);
