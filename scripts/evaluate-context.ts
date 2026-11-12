import { readFile } from "node:fs/promises";
import { DEFAULT_ORGANIZER_MODEL } from "../agents/organizer/config.ts";
import { contextFixtureSchema, evaluateContext } from "./context-evaluation.ts";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey)
  throw new Error("OPENROUTER_API_KEY is required for the separately authorized live evaluation.");
const fixture = contextFixtureSchema.parse(
  JSON.parse(
    await readFile(
      new URL("../fixtures/conversations/context-evaluation.json", import.meta.url),
      "utf8",
    ),
  ),
);
console.log(
  JSON.stringify(
    await evaluateContext({
      apiKey,
      model: process.env.ORGANIZER_MODEL ?? DEFAULT_ORGANIZER_MODEL,
      fixture,
    }),
    null,
    2,
  ),
);
