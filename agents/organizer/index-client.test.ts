import assert from "node:assert/strict";
import test from "node:test";
import { createNoteIndexClient } from "./index-client.ts";

const noteId = "c06c50f6-6716-499c-abdc-3b862d053935";
const serviceToken = "synthetic-token-".repeat(3);
void test("private client sends identifier only, explicit auth, bounded timeout and no redirects", async () => {
  const requests: Request[] = [];
  const client = createNoteIndexClient({
    baseUrl: "https://old-deployment.example",
    serviceToken,
    deploymentProtectionSecret: "synthetic",
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json(
        request.method === "POST"
          ? { status: "started", runId: "wrun_123" }
          : { runId: "wrun_123", status: "running" },
      );
    },
  });
  assert.deepEqual(await client.start(noteId), { status: "started", runId: "wrun_123" });
  assert.equal(await client.status("wrun_123"), "running");
  assert.deepEqual(await requests[0].json(), { noteId });
  assert.equal(requests[0].url, "https://old-deployment.example/internal/note-index/start");
  assert.equal(requests[1].url, "https://old-deployment.example/internal/note-index/runs/wrun_123");
  assert.equal(
    requests[0].headers.get("authorization"),
    `Basic ${Buffer.from(`api:${serviceToken}`).toString("base64")}`,
  );
  assert.equal(requests[0].headers.get("x-vercel-protection-bypass"), "synthetic");
  assert.equal(requests[0].redirect, "error");
  assert.equal(requests[0].credentials, "omit");
  assert.equal(requests[0].cache, "no-store");
});
void test("untrusted endpoints, path injection and malformed identifiers fail before fetch", async () => {
  for (const baseUrl of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/x",
    "https://example.com/?secret=x",
    "https://example.com/#x",
  ]) {
    assert.throws(() => createNoteIndexClient({ baseUrl, serviceToken }));
  }
  const client = createNoteIndexClient({
    baseUrl: "http://127.0.0.1:2027",
    serviceToken,
    fetchImpl: async () => {
      throw new Error("must not fetch");
    },
  });
  await assert.rejects(client.start("invalid"), /Invalid note identifier/);
  await assert.rejects(client.status("../../secret"), /Invalid run identifier/);
});
void test("unknown, mismatched or extra run payloads never establish terminality", async () => {
  for (const body of [
    { runId: "other", status: "completed" },
    { runId: "wrun_123", status: "unknown" },
    { runId: "wrun_123", status: "completed", returnValue: "private note" },
  ]) {
    const client = createNoteIndexClient({
      baseUrl: "https://example.com",
      serviceToken,
      fetchImpl: async () => Response.json(body),
    });
    await assert.rejects(client.status("wrun_123"), /Invalid note index runtime response/);
  }
});
void test("network, provider bodies and 404 are sanitized failures, never terminal status", async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error("SECRET note-content");
    },
    async () => new Response("SECRET note-content", { status: 404 }),
  ]) {
    const client = createNoteIndexClient({
      baseUrl: "https://example.com",
      serviceToken,
      fetchImpl,
    });
    await assert.rejects(client.status("wrun_123"), (error: Error) => {
      assert.equal(error.message, "Note index runtime is unavailable.");
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});
