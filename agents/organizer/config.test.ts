import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ORGANIZER_MODEL, readConfig } from "./config.ts";

const environment = {
  OPENROUTER_API_KEY: "synthetic-test-key",
  ORGANIZER_CONTEXT_TOKENS: "1000000",
  ORGANIZER_IDLE_TIMEOUT_MS: "900000",
  ORGANIZER_SERVICE_TOKEN: "synthetic-service-token-at-least-32-characters",
};

await test("uses the evaluated default when the model is omitted", () => {
  assert.equal(DEFAULT_ORGANIZER_MODEL, "openai/gpt-6-luna");
  assert.equal(readConfig(environment).ORGANIZER_MODEL, DEFAULT_ORGANIZER_MODEL);
});

await test("honors an explicit model and rejects an empty model", () => {
  assert.equal(
    readConfig({ ...environment, ORGANIZER_MODEL: "openai/gpt-6.1-terra" }).ORGANIZER_MODEL,
    "openai/gpt-6.1-terra",
  );
  assert.throws(() => readConfig({ ...environment, ORGANIZER_MODEL: "" }));
});
