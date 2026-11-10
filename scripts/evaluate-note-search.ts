import { createHash, randomUUID } from "node:crypto";
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
const maxRequests = Math.ceil(passages.length / 16) + Math.ceil(fixture.queries.length / 16);
let requests = 0;
const reportedCosts: Array<number | null> = [];
const keyBudgetSchema = z.object({
  data: z.object({
    limit: z.number().positive().max(1),
    limit_remaining: z.number().positive(),
    limit_reset: z.null(),
    include_byok_in_limit: z.literal(true),
  }),
});
const embed = createNoteEmbedder({
  apiKey,
  fetch: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.href !== "https://openrouter.ai/api/v1/embeddings" || requests >= maxRequests)
      throw new Error("Unexpected evaluation request.");
    // Verify the existing experiment key before each paid batch, including BYOK spending.
    const preflight = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!preflight.ok || !keyBudgetSchema.safeParse(await preflight.json()).success)
      throw new Error("Evaluation requires a non-resetting key capped at $1, including BYOK.");
    requests += 1;
    const response = await fetch(input, { ...init, redirect: "error" });
    const usage = z
      .object({ usage: z.object({ cost: z.number().finite().nonnegative() }) })
      .safeParse(
        await response
          .clone()
          .json()
          .catch(() => null),
      );
    reportedCosts.push(usage.success ? usage.data.usage.cost : null);
    return response;
  },
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
      fixtureSha256: createHash("sha256").update(JSON.stringify(fixture)).digest("hex"),
      noteCount: notes.length,
      passageCount: passages.length,
      queryCount: fixture.queries.length,
      top1Hits: answerable.filter((item) => item.expectedRank === 1).length,
      top5Hits: answerable.filter((item) => item.expectedRank !== null && item.expectedRank <= 5)
        .length,
      answerableCount: answerable.length,
      providerReportedInputTokens: tokens,
      requests,
      providerReportedCostCredits: reportedCosts.every((cost) => cost !== null)
        ? reportedCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
        : null,
      results,
    },
    null,
    2,
  ),
);
