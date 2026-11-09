import assert from "node:assert/strict";
import test from "node:test";
import channel from "./agent/channels/note-index.ts";

const serviceToken = "synthetic-private-service-credential";
const authorization = `Basic ${Buffer.from(`atlas-api:${serviceToken}`).toString("base64")}`;
async function request(method: string, path: string, body?: string, authorized = true) {
  const route = channel.routes.find(
    (route) => route.transport !== "websocket" && route.method === method && route.path === path,
  );
  assert.ok(route && route.transport !== "websocket");
  const input = new Request(`http://127.0.0.1:2027${path}`, {
    method,
    headers: authorized ? { authorization } : {},
    ...(body ? { body } : {}),
  });
  // The rejection paths require only route params, not an eve session context.
  return route.handler(input, { params: { runId: "../invalid" } } as unknown as Parameters<
    typeof route.handler
  >[1]);
}
void test("private start and run-status require a valid service credential", async () => {
  const previous = process.env.ORGANIZER_SERVICE_TOKEN;
  process.env.ORGANIZER_SERVICE_TOKEN = serviceToken;
  try {
    for (const [method, path] of [
      ["POST", "/internal/note-index/start"],
      ["GET", "/internal/note-index/runs/:runId"],
    ]) {
      const response = await request(method, path, undefined, false);
      assert.equal(response.status, 401);
    }
    assert.equal((await request("POST", "/internal/note-index/start", "{}")).status, 400);
    assert.equal((await request("POST", "/internal/note-index/start", "invalid")).status, 400);
    assert.equal(
      (await request("POST", "/internal/note-index/start", " ".repeat(257))).status,
      400,
    );
    assert.equal((await request("GET", "/internal/note-index/runs/:runId")).status, 400);
    delete process.env.ORGANIZER_SERVICE_TOKEN;
    assert.equal((await request("POST", "/internal/note-index/start", "{}")).status, 503);
  } finally {
    if (previous === undefined) delete process.env.ORGANIZER_SERVICE_TOKEN;
    else process.env.ORGANIZER_SERVICE_TOKEN = previous;
  }
});
