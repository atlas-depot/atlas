import type { DurableOrganizer } from "../server/organize-runs.ts";

/** Deterministic provider seam. HTTP, ownership, draft persistence and UI remain real. */
export function createAcceptanceOrganizer(): DurableOrganizer {
  const submitted = new Map<string, number>();
  return {
    async allocate({ operationId }) {
      return { sessionId: `acceptance-${operationId}`, deliveryId: null };
    },
    async submit({ sessionId, operationId, note }) {
      // Every acceptance source carries this fact. Fail if the saved input never reaches us.
      if (!note.content.includes("Budget: 42 EUR.")) throw new Error("Missing acceptance fact.");
      submitted.set(sessionId, 0);
      return { sessionId, deliveryId: `delivery-${operationId}` };
    },
    async inspect({ sessionId }) {
      if (!submitted.has(sessionId)) return { status: "failed", reason: "expired" };
      const reads = submitted.get(sessionId)!;
      submitted.set(sessionId, reads + 1);
      if (reads === 0) return { status: "running", phase: "writing" };
      return {
        status: "draft",
        draft: {
          markdown: "# Organized plan\n\nBudget: 42 EUR.",
          sources: [
            {
              id: "fixture-reference",
              title: "Fixture reference",
              url: "https://example.test/reference",
            },
          ],
        },
        usage: { inputTokens: 10, outputTokens: 10, costUsd: 0, complete: true },
      };
    },
    async retire({ sessionId }) {
      submitted.delete(sessionId);
      return { status: "ended" };
    },
  };
}
