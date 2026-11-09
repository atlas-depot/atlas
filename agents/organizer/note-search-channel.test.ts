import assert from "node:assert/strict";
import test from "node:test";
import { EMBEDDING_DIMENSIONS } from "../../shared/embedding.ts";
import { createNoteSearchChannel } from "./agent/channels/note-search.ts";

const token = "synthetic-private-service-credential";
const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));

void test("private query embedding requires service auth and validates before model work", async () => {
  const previous = process.env.ORGANIZER_SERVICE_TOKEN;
  process.env.ORGANIZER_SERVICE_TOKEN = token;
  const inputs: string[] = [];
  const channel = createNoteSearchChannel(async (query) => {
    inputs.push(query);
    return vector();
  });
  const route = channel.routes.find(
    (item) => item.transport !== "websocket" && item.path === "/internal/note-search/embed",
  );
  assert.ok(route && route.transport !== "websocket");
  const request = (body: string, authorized = true) =>
    route.handler(
      new Request("http://127.0.0.1:2027/internal/note-search/embed", {
        method: "POST",
        headers: authorized
          ? { authorization: `Basic ${Buffer.from(`atlas-api:${token}`).toString("base64")}` }
          : {},
        body,
      }),
      { params: {} } as Parameters<typeof route.handler>[1],
    );
  try {
    assert.equal((await request('{"query":"private"}', false)).status, 401);
    for (const body of [
      "invalid",
      "{}",
      '{"query":" "}',
      '{"query":"x","ownerId":"other"}',
      JSON.stringify({ query: "x".repeat(501) }),
      "x".repeat(4097),
    ]) {
      assert.equal((await request(body)).status, 400);
    }
    assert.deepEqual(inputs, []);
    const response = await request('{"query":"Bir not bul"}');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { embedding: vector() });
    assert.deepEqual(inputs, ["Bir not bul"]);
  } finally {
    if (previous === undefined) delete process.env.ORGANIZER_SERVICE_TOKEN;
    else process.env.ORGANIZER_SERVICE_TOKEN = previous;
  }
});

void test("private provider failures never disclose query or provider details", async () => {
  const previous = process.env.ORGANIZER_SERVICE_TOKEN;
  process.env.ORGANIZER_SERVICE_TOKEN = token;
  const channel = createNoteSearchChannel(async () => {
    throw new Error("PRIVATE provider response and credential");
  });
  const route = channel.routes.find(
    (item) => item.transport !== "websocket" && item.path === "/internal/note-search/embed",
  );
  assert.ok(route && route.transport !== "websocket");
  try {
    const response = await route.handler(
      new Request("http://127.0.0.1:2027/internal/note-search/embed", {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`atlas-api:${token}`).toString("base64")}` },
        body: JSON.stringify({ query: "PRIVATE question" }),
      }),
      { params: {} } as Parameters<typeof route.handler>[1],
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Unavailable" });
    delete process.env.ORGANIZER_SERVICE_TOKEN;
    const unavailable = await route.handler(
      new Request("http://127.0.0.1:2027/internal/note-search/embed", {
        method: "POST",
        body: JSON.stringify({ query: "PRIVATE question" }),
      }),
      { params: {} } as Parameters<typeof route.handler>[1],
    );
    assert.equal(unavailable.status, 503);
  } finally {
    if (previous === undefined) delete process.env.ORGANIZER_SERVICE_TOKEN;
    else process.env.ORGANIZER_SERVICE_TOKEN = previous;
  }
});
