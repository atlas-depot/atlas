import assert from "node:assert/strict";
import { test } from "node:test";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../../shared/embedding.ts";
import { createNoteEmbedder, NoteEmbeddingError } from "./embeddings.ts";

const vector = (value = 1) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);
const item = (index: number, embedding: unknown = vector(index + 1)) => ({
  object: "embedding",
  index,
  embedding,
});
const response = (data: unknown[] = [item(0)], model = EMBEDDING_MODEL) =>
  Response.json({ object: "list", model, data });
const hasCode = (code: NoteEmbeddingError["code"]) => (error: unknown) => {
  assert.ok(error instanceof NoteEmbeddingError);
  assert.equal(error.code, code);
  assert.equal(error.cause, undefined);
  return true;
};

await test("uses the fixed model/dimensions and binds shuffled vectors to repeated input positions", async () => {
  const texts = ["# Same private text", "Other source", "# Same private text"];
  let calls = 0;
  const embed = createNoteEmbedder({
    apiKey: "synthetic-key",
    fetch: async (url, init) => {
      calls++;
      assert.equal(
        url instanceof Request ? url.url : typeof url === "string" ? url : url.href,
        "https://openrouter.ai/api/v1/embeddings",
      );
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-key");
      assert.ok(typeof init?.body === "string");
      assert.deepEqual(JSON.parse(init.body), {
        model: EMBEDDING_MODEL,
        input: texts,
        provider: { require_parameters: true },
        dimensions: 1536,
        encoding_format: "float",
      });
      return response([item(2), item(0), item(1)]);
    },
  });
  assert.deepEqual(await embed(texts), [vector(1), vector(2), vector(3)]);
  assert.equal(calls, 1);
});

await test("bounds sequential requests and keeps batch-local response indices in original order", async () => {
  const sizes: number[] = [];
  let active = 0;
  const embed = createNoteEmbedder({
    apiKey: "synthetic-key",
    fetch: async (_url, init) => {
      assert.equal(++active, 1);
      assert.ok(typeof init?.body === "string");
      const body = JSON.parse(init.body) as { input: string[] };
      sizes.push(body.input.length);
      active--;
      return response(body.input.map((value, index) => item(index, vector(Number(value)))));
    },
  });
  const texts = Array.from({ length: 35 }, (_, index) => String(index + 1));
  assert.deepEqual(
    await embed(texts),
    texts.map((value) => vector(Number(value))),
  );
  assert.deepEqual(sizes, [16, 16, 3]);
});

for (const [name, data, model] of [
  ["wrong model", [item(0)], "openai/text-embedding-3-small"],
  ["missing vector", [], EMBEDDING_MODEL],
  ["extra vector", [item(0), item(1)], EMBEDDING_MODEL],
  ["missing index", [{ object: "embedding", embedding: vector() }], EMBEDDING_MODEL],
  ["out-of-range index", [item(1)], EMBEDDING_MODEL],
  ["fractional index", [item(0.5)], EMBEDDING_MODEL],
  ["wrong dimensions", [item(0, [1, 2])], EMBEDDING_MODEL],
  ["zero vector", [item(0, vector(0))], EMBEDDING_MODEL],
  ["float32 overflow", [item(0, vector(1e40))], EMBEDDING_MODEL],
  ["cosine norm overflow", [item(0, vector(1e30))], EMBEDDING_MODEL],
  ["cosine norm underflow", [item(0, vector(1e-30))], EMBEDDING_MODEL],
  ["non-finite value encoded as null", [item(0, vector(Number.NaN))], EMBEDDING_MODEL],
] as const) {
  await test(`rejects ${name} without fallback or retry`, async () => {
    let calls = 0;
    const embed = createNoteEmbedder({
      apiKey: "synthetic-key",
      fetch: async () => {
        calls++;
        return response([...data], model);
      },
    });
    await assert.rejects(embed(["Private source"]), hasCode("invalid_embedding"));
    assert.equal(calls, 1);
  });
}

await test("rejects duplicate indices even when the vector count matches", async () => {
  const embed = createNoteEmbedder({
    apiKey: "synthetic-key",
    fetch: async () => response([item(0), item(0)]),
  });
  await assert.rejects(embed(["A", "B"]), hasCode("invalid_embedding"));
});

await test("provider failure does not expose request/response content or retry", async () => {
  let calls = 0;
  const embed = createNoteEmbedder({
    apiKey: "synthetic-secret",
    fetch: async () => {
      calls++;
      return Response.json(
        { error: { message: "private note synthetic-secret" } },
        { status: 503 },
      );
    },
  });
  await assert.rejects(embed(["private note"]), (error: unknown) => {
    hasCode("provider_unavailable")(error);
    assert.doesNotMatch(String(error), /private note|synthetic-secret/);
    assert.doesNotMatch(JSON.stringify(error), /private note|synthetic-secret/);
    return true;
  });
  assert.equal(calls, 1);
});

await test("empty input and pre-aborted work make no provider request", async () => {
  let calls = 0;
  const embed = createNoteEmbedder({
    apiKey: "synthetic-key",
    fetch: async () => {
      calls++;
      return response();
    },
  });
  assert.deepEqual(await embed([]), []);
  await assert.rejects(
    embed(["Private source"], AbortSignal.abort(new Error("private cancellation"))),
    hasCode("provider_unavailable"),
  );
  assert.equal(calls, 0);
});

await test("cancellation reaches the in-flight HTTP request and stops later batches", async () => {
  const abort = new AbortController();
  let calls = 0;
  const embed = createNoteEmbedder({
    apiKey: "synthetic-key",
    fetch: async (_url, init) => {
      calls++;
      assert.ok(init?.signal);
      abort.abort(new Error("Private abort reason"));
      init.signal.throwIfAborted();
      return response();
    },
  });
  await assert.rejects(
    embed(
      Array.from({ length: 17 }, () => "Private source"),
      abort.signal,
    ),
    hasCode("provider_unavailable"),
  );
  assert.equal(calls, 1);
});

await test("validates the whole input before sending any text", async () => {
  let calls = 0;
  const embed = createNoteEmbedder({
    apiKey: "synthetic-key",
    fetch: async () => {
      calls++;
      return response();
    },
  });
  await assert.rejects(embed([...Array.from({ length: 16 }, () => "Valid"), "\u0000"]), TypeError);
  assert.equal(calls, 0);
});
