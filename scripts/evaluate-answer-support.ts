import { readFile } from "node:fs/promises";
import { answerSupportFixtureSchema, evaluateAnswerSupport } from "./answer-support-evaluation.ts";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey)
  throw new Error("OPENROUTER_API_KEY is required for the separately authorized live evaluation.");
const fixture = answerSupportFixtureSchema.parse(
  JSON.parse(
    await readFile(
      new URL("../fixtures/conversations/answer-support-evaluation.json", import.meta.url),
      "utf8",
    ),
  ),
);
console.log(
  JSON.stringify(
    await evaluateAnswerSupport({
      apiKey,
      model: process.env.ORGANIZER_MODEL ?? "anthropic/claude-sonnet-5.5",
      judgeModel: process.env.ANSWER_EVAL_JUDGE_MODEL,
      fixture,
    }),
    null,
    2,
  ),
);
