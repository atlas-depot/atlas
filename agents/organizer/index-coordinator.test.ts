import assert from "node:assert/strict";
import test from "node:test";
import { EMBEDDING_FINGERPRINT } from "../../shared/embedding.ts";
import {
  createIndexCoordinator,
  indexRetryAt,
  type IndexCoordinatorPorts,
} from "./index-coordinator.ts";

const claim = {
  noteId: "c06c50f6-6716-499c-abdc-3b862d053935",
  revision: 1,
  fingerprint: EMBEDDING_FINGERPRINT,
  token: "f50a3aef-a07e-4913-a049-e439e7cf2735",
  runtimeUrl: "https://old.example",
};
const now = Date.parse("2026-11-09T12:00:00Z");
function fixture(overrides: Partial<IndexCoordinatorPorts> = {}) {
  const events: string[] = [];
  const ports: IndexCoordinatorPorts = {
    runtimeUrl: "https://new.example",
    now: () => now,
    random: () => 0.5,
    jobs: {
      claimWithAttempt: async () => {
        events.push("claim");
        return { claim, attempts: 0 };
      },
      recordRun: async () => {
        events.push("record");
        return true;
      },
      fail: async (_claim, _run, code, retryAt) => {
        events.push(`fail:${code}:${retryAt?.toISOString()}`);
        return true;
      },
      release: async () => {
        events.push("release");
        return true;
      },
      pending: async () => [
        {
          ...claim,
          runId: "wrun_old",
          claimedAt: new Date(now - 180_000).toISOString(),
          retryAt: new Date(now).toISOString(),
          failureCode: null,
          attempts: 3,
        },
      ],
    },
    startRun: async () => {
      events.push("start");
      return "wrun_new";
    },
    status: async (url, id) => {
      events.push(`status:${url}:${id}`);
      return "running";
    },
    ...overrides,
  };
  return { ports, events, coordinator: createIndexCoordinator(ports) };
}
void test("start binds the durable claim to the returned run", async () => {
  const { coordinator, events } = fixture();
  assert.deepEqual(await coordinator.start(claim.noteId), { status: "started", runId: "wrun_new" });
  assert.deepEqual(events, ["claim", "start", "record"]);
});
void test("already claimed work never starts another Workflow", async () => {
  const f = fixture();
  f.ports.jobs.claimWithAttempt = async () => null;
  assert.deepEqual(await f.coordinator.start(claim.noteId), { status: "unchanged" });
  assert.deepEqual(f.events, []);
});
void test("ambiguous start persists a safe failure without releasing the token", async () => {
  const f = fixture({
    startRun: async () => {
      throw new Error("SECRET");
    },
  });
  await assert.rejects(f.coordinator.start(claim.noteId), /Note index runtime is unavailable/);
  assert.deepEqual(f.events, ["claim", "fail:runtime_unavailable:2026-11-09T12:00:15.000Z"]);
});
void test("old running deployment remains authoritative regardless of claim age", async () => {
  const f = fixture();
  await f.coordinator.sweep();
  assert.deepEqual(f.events, ["status:https://old.example:wrun_old"]);
});
void test("repeated save wake uses persisted attempts without adding them to Workflow arguments", async () => {
  const f = fixture({
    startRun: async (argument) => {
      assert.deepEqual(argument, claim);
      throw new Error("Unknown start outcome");
    },
  });
  f.ports.jobs.claimWithAttempt = async () => ({ claim, attempts: 4 });
  await assert.rejects(f.coordinator.start(claim.noteId), /Note index runtime is unavailable/);
  assert.deepEqual(f.events, ["fail:runtime_unavailable:2026-11-09T12:04:00.000Z"]);
});
void test("unknown network or 404 leaves claims untouched", async () => {
  const f = fixture({
    status: async () => {
      throw new Error("404");
    },
  });
  assert.equal((await f.coordinator.sweep()).uncertain, 1);
  assert.deepEqual(f.events, []);
});
void test("confirmed terminal missing publication is scheduled for retry before release", async () => {
  for (const status of ["completed", "failed", "cancelled"] as const) {
    const f = fixture({ status: async () => status });
    await f.coordinator.sweep();
    assert.match(
      f.events[0],
      new RegExp(`fail:${status === "completed" ? "completion_missing" : "runtime_failed"}:`),
    );
    assert.deepEqual(f.events.slice(1), ["release", "claim", "start", "record"]);
  }
});
void test("persisted permanent failure is released without inventing a retry", async () => {
  const f = fixture({ status: async () => "completed" });
  const row = (await f.ports.jobs.pending(5))[0];
  f.ports.jobs.pending = async () => [
    { ...row, failureCode: "unsupported_content", retryAt: null },
  ];
  f.ports.jobs.claimWithAttempt = async () => null;
  await f.coordinator.sweep();
  assert.deepEqual(f.events, ["release"]);
});
void test("missing run IDs remain claimed until the two minute allocation grace expires", async () => {
  for (const age of [119_999, 120_000]) {
    const f = fixture();
    const row = (await f.ports.jobs.pending(5))[0];
    f.ports.jobs.pending = async () => [
      { ...row, runId: null, claimedAt: new Date(now - age).toISOString() },
    ];
    await f.coordinator.sweep();
    assert.deepEqual(f.events, age < 120_000 ? [] : ["release", "claim", "start", "record"]);
  }
});
void test("full jitter doubles from 30 seconds and caps at 15 minutes", () => {
  assert.equal(indexRetryAt(1, now, () => 1).getTime() - now, 30_000);
  assert.equal(indexRetryAt(2, now, () => 0.5).getTime() - now, 30_000);
  assert.equal(indexRetryAt(99, now, () => 1).getTime() - now, 900_000);
  assert.equal(indexRetryAt(99, now, () => 0).getTime(), now);
});
