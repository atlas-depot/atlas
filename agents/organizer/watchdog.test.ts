import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEvent, SessionStreamEvent } from "eve/client";
import { createOrganizerWatchdog, validateOrganizerTimeouts } from "./watchdog.ts";

const timeouts = { startupMs: 50, modelSilenceMs: 100, researchMs: 500 };
const signal = () => new AbortController().signal;
const event = (value: SessionEvent): SessionStreamEvent => ({
  ...value,
  meta: { at: "2026-11-01T00:00:00Z", position: { line: 0, index: 0 } },
});
const requested = (callId: string) =>
  event({
    type: "call.requested",
    data: { callId, owner: { runId: "model-1" }, capability: { kind: "tool", name: "research" } },
  });
const settled = (callId: string) =>
  event({
    type: "call.settled",
    data: { callId, outcome: "completed" },
  });
const content = (delta: string, kind?: string) =>
  event({
    type: "content.delta",
    data: { partId: "part-1", ...(kind === undefined ? {} : { kind }), delta },
  });

await test("timeout configuration rejects timer overflow and nonpositive/noninteger values", () => {
  for (const invalid of [0, -1, 0.5, NaN, Infinity, 2_147_483_648]) {
    for (const key of ["startupMs", "modelSilenceMs", "researchMs"] as const) {
      assert.throws(() => validateOrganizerTimeouts({ ...timeouts, [key]: invalid }), /timer-safe/);
    }
  }
  assert.doesNotThrow(() =>
    validateOrganizerTimeouts({ startupMs: 1, modelSilenceMs: 2_147_483_647, researchMs: 1 }),
  );
});

await test("a stalled creation times out without pretending its remote state is known", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = createOrganizerWatchdog(timeouts, signal());
  t.mock.timers.tick(50);
  assert.equal(watch.signal.aborted, true);
  assert.equal(watch.signal.reason.name, "TimeoutError");
  assert.match(watch.signal.reason.message, /remote state is unconfirmed/);
});

await test("acceptance replaces startup deadline with first-output silence deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = createOrganizerWatchdog(timeouts, signal());
  t.mock.timers.tick(40);
  watch.accepted();
  t.mock.timers.tick(99);
  assert.equal(watch.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.match(watch.signal.reason.message, /model output/);
});

await test("reasoning, text continuation and tool input keep progressing work alive without a total cap", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = createOrganizerWatchdog(timeouts, signal());
  watch.accepted();
  for (let i = 0; i < 20; i += 1) {
    t.mock.timers.tick(90);
    watch.observe(
      i % 3 === 0
        ? content("thinking", "reasoning")
        : i % 3 === 1
          ? content("continued text")
          : event({
              type: "call.input",
              data: { callId: "call-1", delta: "query tokens" },
            }),
    );
    assert.equal(watch.signal.aborted, false);
  }
  t.mock.timers.tick(100);
  assert.match(watch.signal.reason.message, /model output/);
});

await test("metadata and empty content never refresh the model deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = createOrganizerWatchdog(timeouts, signal());
  watch.accepted();
  t.mock.timers.tick(90);
  watch.observe(event({ type: "session.started", data: {} }));
  watch.observe(
    event({
      type: "model.settled",
      data: { runId: "model-1", outcome: "completed", finishReason: "stop" },
    }),
  );
  watch.observe(content("", "text"));
  t.mock.timers.tick(10);
  assert.equal(watch.signal.aborted, true);
});

await test("research has its own deadline instead of the shorter model silence window", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = createOrganizerWatchdog(timeouts, signal());
  watch.accepted();
  watch.observe(requested("call-1"));
  t.mock.timers.tick(499);
  assert.equal(watch.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.match(watch.signal.reason.message, /research stalled/);
});

await test("model activity and duplicate requests cannot extend an in-flight research deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = createOrganizerWatchdog(timeouts, signal());
  watch.accepted();
  watch.observe(requested("call-1"));
  t.mock.timers.tick(450);
  watch.observe(content("Still thinking", "reasoning"));
  watch.observe(requested("call-1"));
  watch.observe(event({ type: "call.progress", data: { callId: "call-1", output: "Searching" } }));
  t.mock.timers.tick(50);
  assert.match(watch.signal.reason.message, /research stalled/);
});

await test("concurrent research keeps independent deadlines when another call settles", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = createOrganizerWatchdog(timeouts, signal());
  watch.accepted();
  watch.observe(requested("old-call"));
  t.mock.timers.tick(100);
  watch.observe(requested("new-call"));
  t.mock.timers.tick(100);
  watch.observe(settled("new-call"));
  t.mock.timers.tick(299);
  assert.equal(watch.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.match(watch.signal.reason.message, /research stalled/);
});

await test("all research settling restores model silence timing, unrelated settlements do not", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = createOrganizerWatchdog(timeouts, signal());
  watch.accepted();
  watch.observe(requested("call-1"));
  t.mock.timers.tick(400);
  watch.observe(settled("call-1"));
  t.mock.timers.tick(90);
  watch.observe(settled("unrelated"));
  t.mock.timers.tick(10);
  assert.match(watch.signal.reason.message, /model output/);
});

await test("dispose clears model and concurrent research timers and ignores later activity", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = createOrganizerWatchdog(timeouts, signal());
  watch.accepted();
  watch.observe(requested("call-1"));
  watch.observe(requested("call-2"));
  watch.dispose();
  watch.accepted();
  watch.observe(content("Late text", "text"));
  t.mock.timers.tick(10_000);
  assert.equal(watch.signal.aborted, false);
});

await test("caller cancellation remains cancellation after every watchdog deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const caller = new AbortController();
  const watch = createOrganizerWatchdog(timeouts, caller.signal);
  watch.accepted();
  watch.observe(requested("call-1"));
  caller.abort(new DOMException("User cancelled", "AbortError"));
  t.mock.timers.tick(10_000);
  assert.equal(watch.signal.reason.name, "AbortError");
  assert.equal(watch.signal.reason.message, "User cancelled");
});
