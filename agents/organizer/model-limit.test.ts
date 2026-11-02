import assert from "node:assert/strict";
import { test } from "node:test";
import { emptySessionView, foldEvents, type FactOf } from "eve/events";
import { enforceModelLimit } from "./agent/hooks/model-limit.ts";

await test("the runtime guard reconstructs its limit from replayed facts without a reader", () => {
  const facts: FactOf<"model.requested">[] = Array.from({ length: 17 }, (_, index) => ({
    type: "model.requested",
    scope: { turnId: "turn-1" },
    data: { runId: `model-${index}`, owner: { turnId: "turn-1" } },
  }));
  const recorded = facts.map((fact, index) => ({
    ...fact,
    meta: { at: "2026-11-01T00:00:00Z", position: { line: index, index: 0 } },
  }));
  const cancellations: string[] = [];
  const cancel = (reason: string) => {
    cancellations.push(reason);
  };
  enforceModelLimit(facts[15]!, {
    view: foldEvents(emptySessionView(), recorded.slice(0, 16)),
    cancel,
  });
  assert.equal(cancellations.length, 0);
  // A fresh process folds recorded history. No mutable counter is carried over.
  enforceModelLimit(facts[16]!, { view: foldEvents(emptySessionView(), recorded), cancel });
  assert.equal(cancellations.length, 1);
  enforceModelLimit(
    { type: "model.requested", data: { runId: "other", owner: { turnId: "turn-2" } } },
    { view: foldEvents(emptySessionView(), recorded), cancel },
  );
  assert.equal(cancellations.length, 1);
});
