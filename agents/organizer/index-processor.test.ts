import assert from "node:assert/strict";
import test from "node:test";
import { EMBEDDING_FINGERPRINT } from "../../shared/embedding.ts";
import { NoteEmbeddingError } from "./embeddings.ts";
import { createIndexProcessor } from "./index-processor.ts";

const claim = {
  noteId: "c06c50f6-6716-499c-abdc-3b862d053935",
  revision: 2,
  fingerprint: EMBEDDING_FINGERPRINT,
  token: "f50a3aef-a07e-4913-a049-e439e7cf2735",
  runtimeUrl: "https://runtime.example",
};
const now = Date.parse("2026-11-09T12:00:00Z");
function fixture(content = "A synthetic paragraph.") {
  const events: unknown[] = [];
  const current = {
    note: {
      id: claim.noteId,
      title: "Synthetic",
      content,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
    revision: 2,
    ownerId: "owner-from-db",
    attempts: 2,
  };
  const ports: Parameters<typeof createIndexProcessor>[0] = {
    jobs: {
      bind: async () => current,
      fail: async (...args) => {
        events.push(args);
        return true;
      },
    },
    store: {
      publish: async (...args) => {
        events.push(args);
        return "published";
      },
    },
    embed: async (texts) => {
      events.push(texts);
      return texts.map(() => [0.25]);
    },
    now: () => now,
    random: () => 0.5,
  };
  return { ports, events, process: createIndexProcessor(ports) };
}
void test("processor projects the fresh revision and publishes with the exact claim/run guard", async () => {
  const f = fixture();
  assert.equal(await f.process(claim, "wrun_one"), "published");
  assert.deepEqual(f.events[0], ["A synthetic paragraph."]);
  const [owner, publication, guard] = f.events[1] as [
    string,
    { revision: number; projection: { passages: { source: { version: string } }[] } },
    unknown,
  ];
  assert.equal(owner, "owner-from-db");
  assert.equal(publication.revision, 2);
  assert.equal(
    publication.projection.passages[0].source.version,
    JSON.stringify(`${claim.noteId}:2`),
  );
  assert.deepEqual(guard, { claim, runId: "wrun_one" });
});
void test("duplicate run or already consumed intent is a content-free no-op before provider", async () => {
  const f = fixture();
  f.ports.jobs.bind = async () => null;
  assert.equal(await f.process(claim, "wrun_duplicate"), "superseded");
  assert.deepEqual(f.events, []);
});
void test("empty notes publish a ready empty index without contacting the provider", async () => {
  const f = fixture("");
  assert.equal(await f.process(claim, "wrun_one"), "published");
  assert.equal(f.events.length, 1);
});
void test("partial and unsupported projections never publish a searchable subset", async () => {
  for (const content of [
    "![image](https://example.com/image.png)",
    "text\n\n![image](https://example.com/image.png)",
  ]) {
    const f = fixture(content);
    assert.equal(await f.process(claim, "wrun_one"), "failed");
    assert.deepEqual(f.events, [[claim, "wrun_one", "unsupported_content", null]]);
  }
});
void test("invalid vector and provider failures persist sanitized bounded retry metadata", async () => {
  for (const code of ["invalid_embedding", "provider_unavailable"] as const) {
    const f = fixture();
    f.ports.embed = async () => {
      throw new NoteEmbeddingError(code);
    };
    assert.equal(await f.process(claim, "wrun_one"), "failed");
    assert.deepEqual(f.events, [[claim, "wrun_one", code, new Date(now + 60_000)]]);
  }
});
void test("unexpected errors are reduced to a code and never become Workflow output", async () => {
  const f = fixture();
  f.ports.embed = async () => {
    throw new Error("SECRET note text");
  };
  const result = await f.process(claim, "wrun_one");
  assert.equal(result, "failed");
  assert.equal(JSON.stringify(f.events).includes("SECRET"), false);
  assert.deepEqual(f.events, [[claim, "wrun_one", "runtime_failed", new Date(now + 60_000)]]);
});
void test("concurrent source edit/deletion does not publish the previous revision", async () => {
  for (const status of ["stale", "unavailable"] as const) {
    const f = fixture();
    f.ports.store.publish = async () => status;
    assert.equal(await f.process(claim, "wrun_one"), "superseded");
  }
});
