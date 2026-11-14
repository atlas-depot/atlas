import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vite-plus/test";
import { blockNoteDocumentSchema } from "../../shared/document.ts";
import type { SourceDependency } from "../conversation-context.ts";
import { conversationResearchRequests } from "./conversation-schema.ts";
import { createConversationTurns } from "./conversation-turns.ts";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import {
  conversationContexts,
  conversationMessages,
  conversationTurnInputs,
  conversationTurns,
  conversations,
} from "./conversation-schema.ts";
import { createNoteStore, noteTag } from "./notes.ts";

const database = setupIndexTestDatabase();

type FixtureOptions = {
  input?: string;
  note?: { title: string; blocks: unknown[] };
  retrievalBytes?: number;
  summary?: string | null;
  recent?: { id: string; sequence: number; role: "user" | "assistant"; text: string }[];
};

async function fixture(question: string, options: FixtureOptions = {}) {
  const owner = `owner-${randomUUID()}`;
  const conversationId = randomUUID();
  const turnId = randomUUID();
  const sessionId = `session-${randomUUID()}`;
  const inputId = randomUUID();
  const allocationOperationId = randomUUID();
  const [parent] = await database.db
    .insert(conversations)
    .values({ id: conversationId, ownerId: owner, nextSequence: 2 })
    .returning();
  if (!parent) throw new Error("Conversation fixture was not created.");

  let sources: SourceDependency[] = [];
  if (options.note) {
    const stored = await createNoteStore(database.db).create(owner, {
      title: options.note.title,
      content: blockNoteDocumentSchema.parse({
        format: "blocknote",
        schemaVersion: 1,
        blocks: options.note.blocks,
      }),
      createdAt: "2026-11-13T12:00:00.000Z",
    });
    sources = [{ noteId: stored.note.id, version: noteTag(stored.note.id, stored.revision) }];
  }

  await database.db.insert(conversationTurns).values({
    id: turnId,
    conversationId,
    operationId: randomUUID(),
    payloadHash: "a".repeat(64),
    status: "running",
    runningText: "",
    allocationOperationId,
    runtimeUrl: "https://runtime.example.test",
    sessionId,
    sourceDependencies: sources,
    retrievalBytes: options.retrievalBytes ?? 0,
    provenanceComplete: true,
  });
  await database.db.insert(conversationMessages).values({
    id: inputId,
    conversationId,
    operationId: randomUUID(),
    payloadHash: "b".repeat(64),
    sequence: 1,
    role: "user",
    deliveryPolicy: "queue",
    text: options.input ?? question,
  });
  await database.db.insert(conversationTurnInputs).values({
    conversationId,
    turnId,
    messageId: inputId,
    ordinal: 0,
  });
  await database.db.insert(conversationContexts).values({
    conversationId,
    turnId,
    operationId: randomUUID(),
    state: "ready",
    throughSequence: 1,
    deferredInputIds: [],
    recent: options.recent ?? [],
    summary: options.summary ?? null,
    summaryInput: null,
    sources,
    runtimeUrl: "https://runtime.example.test",
  });
  return {
    owner,
    conversationId,
    turnId,
    sessionId,
    inputId,
    turns: createConversationTurns(database.db),
  };
}

it("lets a query with no private overlap run without approval", async () => {
  const f = await fixture("What are current public onboarding practices?", {
    input: "Look at my notes.",
  });
  const prepared = await f.turns.research.prepare(f.sessionId, {
    question: "What are current public onboarding practices?",
  });
  expect(prepared).toMatchObject({
    status: "generalized",
    outboundQuestion: "What are current public onboarding practices?",
  });
  if (prepared.status !== "generalized") throw new Error("Expected a generalized query.");
  expect(
    await f.turns.research.claimGeneralized(f.sessionId, {
      question: "What are current public onboarding practices?",
      outboundQuestion: prepared.outboundQuestion,
      queryHash: prepared.queryHash,
      contextHash: prepared.contextHash,
    }),
  ).toBe("claimed");
});

it("counts autonomous attempts toward the same per-turn limit", async () => {
  const f = await fixture("What are public onboarding practices one?", {
    input: "Look at my notes.",
  });
  for (const suffix of ["one", "two", "three"]) {
    const question = `What are public onboarding practices ${suffix}?`;
    const prepared = await f.turns.research.prepare(f.sessionId, { question });
    if (prepared.status !== "generalized") throw new Error("Expected a generalized query.");
    expect(
      await f.turns.research.claimGeneralized(f.sessionId, {
        question,
        outboundQuestion: prepared.outboundQuestion,
        queryHash: prepared.queryHash,
        contextHash: prepared.contextHash,
      }),
    ).toBe("claimed");
  }
  const fourth = await f.turns.research.prepare(f.sessionId, {
    question: "What are public onboarding practices four?",
  });
  if (fourth.status !== "generalized") throw new Error("Expected a generalized query.");
  expect(
    await f.turns.research.claimGeneralized(f.sessionId, {
      question: "What are public onboarding practices four?",
      outboundQuestion: fourth.outboundQuestion,
      queryHash: fourth.queryHash,
      contextHash: fourth.contextHash,
    }),
  ).toBe("limit");
});

it("requires approval when a private term crosses styled inline spans", async () => {
  const f = await fixture("What public information exists about bluebird?", {
    input: "Look at my notes.",
    note: {
      title: "Private planning",
      blocks: [
        {
          id: "first",
          type: "paragraph",
          props: {},
          content: [
            { type: "text", text: "The internal ", styles: {} },
            { type: "text", text: "blue", styles: { bold: true } },
            { type: "text", text: "bird", styles: { italic: true } },
          ],
          children: [],
        },
      ],
    },
  });
  expect(
    await f.turns.research.prepare(f.sessionId, {
      question: "What public information exists about bluebird?",
    }),
  ).toMatchObject({ status: "approval_required" });
});

it("requires approval when a private term exists only in a nested child block", async () => {
  const f = await fixture("What public information exists about bluebird?", {
    input: "Look at my notes.",
    note: {
      title: "Private planning",
      blocks: [
        {
          id: "parent",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "Look at the planning note", styles: {} }],
          children: [
            {
              id: "child",
              type: "paragraph",
              props: {},
              content: [{ type: "text", text: "bluebird", styles: {} }],
              children: [],
            },
          ],
        },
      ],
    },
  });
  expect(
    await f.turns.research.prepare(f.sessionId, {
      question: "What public information exists about bluebird?",
    }),
  ).toMatchObject({ status: "approval_required" });
});

it("requires approval when a phrase is split across table cells", async () => {
  const f = await fixture("What does the secret code unlock?", {
    input: "Look at my notes.",
    note: {
      title: "Private planning",
      blocks: [
        {
          id: "table",
          type: "table",
          props: {},
          content: {
            type: "tableContent",
            columnWidths: [180, 180],
            rows: [
              {
                cells: [
                  [{ type: "text", text: "secret", styles: {} }],
                  [{ type: "text", text: "code", styles: {} }],
                ],
              },
            ],
          },
          children: [],
        },
      ],
    },
  });
  expect(
    await f.turns.research.prepare(f.sessionId, {
      question: "What does the secret code unlock?",
    }),
  ).toMatchObject({ status: "approval_required" });
});

it("screens a phrase that exists only in this turn's transcript", async () => {
  const f = await fixture("What public companies use bluebird horizon project?", {
    input: "Our internal codename is bluebird horizon project.",
  });
  expect(
    await f.turns.research.prepare(f.sessionId, {
      question: "What public companies use bluebird horizon project?",
    }),
  ).toMatchObject({ status: "approval_required" });
});

it("screens the conversation summary and recent messages", async () => {
  const summary = await fixture("What public options use bluebird horizon?", {
    input: "Look at my notes.",
    summary: "The private codename is bluebird horizon.",
  });
  expect(
    await summary.turns.research.prepare(summary.sessionId, {
      question: "What public options use bluebird horizon?",
    }),
  ).toMatchObject({ status: "approval_required" });

  const recent = await fixture("What public options use orbit program?", {
    input: "Look at my notes.",
    recent: [
      {
        id: randomUUID(),
        sequence: 1,
        role: "assistant",
        text: "The private codename is orbit program.",
      },
    ],
  });
  expect(
    await recent.turns.research.prepare(recent.sessionId, {
      question: "What public options use orbit program?",
    }),
  ).toMatchObject({ status: "approval_required" });
});

it("screens a private URL stored only as a note link destination", async () => {
  const f = await fixture("What does https://internal.example.com/secret/roadmap say?", {
    input: "Look at my notes.",
    note: {
      title: "Dashboard",
      blocks: [
        {
          id: "link",
          type: "paragraph",
          props: {},
          content: [
            {
              type: "link",
              href: "https://internal.example.com/secret/roadmap",
              content: [{ type: "text", text: "open", styles: {} }],
            },
          ],
          children: [],
        },
      ],
    },
  });
  expect(
    await f.turns.research.prepare(f.sessionId, {
      question: "What does https://internal.example.com/secret/roadmap say?",
    }),
  ).toMatchObject({ status: "approval_required" });
});

it("screens lowercase, short and uncased private names and private URLs", async () => {
  for (const { question, input } of [
    {
      question: "jane okafor acme layoffs severance",
      input: "met jane okafor from acme re layoffs",
    },
    {
      question: "Li public profile",
      input: "Li Wei is a private contact.",
    },
    {
      question: "肝癌治疗",
      input: "张三患有肝癌。",
    },
    {
      question: "What does https://internal.example.com/secret/roadmap say?",
      input: "Internal dashboard: https://internal.example.com/secret/roadmap",
    },
  ]) {
    const f = await fixture(question, { input });
    expect(await f.turns.research.prepare(f.sessionId, { question })).toMatchObject({
      status: "approval_required",
    });
  }
});

it("requires approval for direct identifiers even when notes and history are unrelated", async () => {
  for (const question of [
    "Find 0532 123 45 67 online",
    "Find 4111 1111 1111 1111 online",
    "Find TR33 0006 1005 1978 6457 8413 26 online",
    "Find public records for 1234",
  ]) {
    const f = await fixture(question, { input: "Look at my notes." });
    expect(await f.turns.research.prepare(f.sessionId, { question })).toMatchObject({
      status: "approval_required",
    });
  }
});

it("presents and authorizes only an owner-bound, exact, current disclosure request", async () => {
  const f = await fixture("What did Maya Chen earn at Northstar Labs?");
  const prepared = await f.turns.research.prepare(f.sessionId, {
    question: "What did Maya Chen earn at Northstar Labs?",
  });
  expect(prepared.status).toBe("approval_required");
  if (prepared.status !== "approval_required") throw new Error("Expected an approval request.");
  expect(prepared.request.proposedQuery).toBe("What did Maya Chen earn at Northstar Labs?");

  const listed = await f.turns.research.list(f.owner, f.conversationId);
  expect(listed).toMatchObject({
    requests: [
      {
        id: prepared.request.id,
        proposedQuery: prepared.request.proposedQuery,
        status: "pending",
      },
    ],
  });
  expect(await f.turns.research.list(`other-${randomUUID()}`, f.conversationId)).toBeUndefined();
  expect(
    await f.turns.research.decide(
      `other-${randomUUID()}`,
      f.conversationId,
      prepared.request.id,
      prepared.request.queryHash,
      "approve",
    ),
  ).toEqual({ status: "not_found" });
  expect(
    await f.turns.research.decide(
      f.owner,
      f.conversationId,
      prepared.request.id,
      "c".repeat(64),
      "approve",
    ),
  ).toEqual({ status: "mismatch" });
  expect(
    await f.turns.research.decide(
      f.owner,
      f.conversationId,
      prepared.request.id,
      prepared.request.queryHash,
      "approve",
    ),
  ).toEqual({ status: "approved" });

  await database.db
    .update(conversationMessages)
    .set({ text: "The private request context changed." })
    .where(eq(conversationMessages.id, f.inputId));
  expect(
    await f.turns.research.claimApproved(
      f.sessionId,
      prepared.request.id,
      prepared.request.queryHash,
      prepared.contextHash,
    ),
  ).toBe("stale");
  const [stale] = await database.db
    .select()
    .from(conversationResearchRequests)
    .where(eq(conversationResearchRequests.id, prepared.request.id));
  expect(stale).toMatchObject({ status: "stale", proposedQuery: null });
});

it("claims a successful approval exactly once and clears its payload", async () => {
  const f = await fixture("What did Maya Chen earn?");
  const prepared = await f.turns.research.prepare(f.sessionId, {
    question: "What did Maya Chen earn?",
    requiresPrivateDisclosure: true,
  });
  if (prepared.status !== "approval_required") throw new Error("Expected an approval request.");
  expect(
    await f.turns.research.decide(
      f.owner,
      f.conversationId,
      prepared.request.id,
      prepared.request.queryHash,
      "approve",
    ),
  ).toEqual({ status: "approved" });
  expect(await f.turns.research.list(f.owner, f.conversationId)).toMatchObject({
    requests: [{ id: prepared.request.id, status: "approved" }],
  });
  expect(
    await f.turns.research.claimApproved(
      f.sessionId,
      prepared.request.id,
      prepared.request.queryHash,
      prepared.contextHash,
    ),
  ).toBe("claimed");
  const [claimed] = await database.db
    .select()
    .from(conversationResearchRequests)
    .where(eq(conversationResearchRequests.id, prepared.request.id));
  expect(claimed).toMatchObject({ status: "started", proposedQuery: null });
  expect(await f.turns.research.list(f.owner, f.conversationId)).toEqual({ requests: [] });
  expect(
    await f.turns.research.claimApproved(
      f.sessionId,
      prepared.request.id,
      prepared.request.queryHash,
      prepared.contextHash,
    ),
  ).toBe("stale");
});

it("allows a later denial before execution and forbids re-approval", async () => {
  const f = await fixture("What did Maya Chen earn?");
  const prepared = await f.turns.research.prepare(f.sessionId, {
    question: "What did Maya Chen earn?",
    requiresPrivateDisclosure: true,
  });
  if (prepared.status !== "approval_required") throw new Error("Expected an approval request.");
  expect(
    await f.turns.research.decide(
      f.owner,
      f.conversationId,
      prepared.request.id,
      prepared.request.queryHash,
      "approve",
    ),
  ).toEqual({ status: "approved" });
  expect(
    await f.turns.research.decide(
      f.owner,
      f.conversationId,
      prepared.request.id,
      prepared.request.queryHash,
      "deny",
    ),
  ).toEqual({ status: "denied" });
  const [denied] = await database.db
    .select()
    .from(conversationResearchRequests)
    .where(eq(conversationResearchRequests.id, prepared.request.id));
  expect(denied).toMatchObject({ status: "denied", proposedQuery: null });
  expect(
    await f.turns.research.decide(
      f.owner,
      f.conversationId,
      prepared.request.id,
      prepared.request.queryHash,
      "approve",
    ),
  ).toEqual({ status: "conflict" });
});

it("never expires or overwrites a claimed request", async () => {
  const f = await fixture("What did Maya Chen earn?");
  const prepared = await f.turns.research.prepare(f.sessionId, {
    question: "What did Maya Chen earn?",
    requiresPrivateDisclosure: true,
  });
  if (prepared.status !== "approval_required") throw new Error("Expected an approval request.");
  await database.db
    .update(conversationResearchRequests)
    .set({
      status: "started",
      proposedQuery: null,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    .where(eq(conversationResearchRequests.id, prepared.request.id));
  expect(
    await f.turns.research.claimApproved(
      f.sessionId,
      prepared.request.id,
      prepared.request.queryHash,
      prepared.contextHash,
    ),
  ).toBe("stale");
  const [started] = await database.db
    .select()
    .from(conversationResearchRequests)
    .where(eq(conversationResearchRequests.id, prepared.request.id));
  expect(started).toMatchObject({ status: "started" });
});

it("expires an approved request without leaving an outbound payload", async () => {
  const f = await fixture("What did Maya Chen earn?");
  const prepared = await f.turns.research.prepare(f.sessionId, {
    question: "What did Maya Chen earn?",
    requiresPrivateDisclosure: true,
  });
  if (prepared.status !== "approval_required") throw new Error("Expected an approval request.");
  await f.turns.research.decide(
    f.owner,
    f.conversationId,
    prepared.request.id,
    prepared.request.queryHash,
    "approve",
  );
  await database.db
    .update(conversationResearchRequests)
    .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
    .where(eq(conversationResearchRequests.id, prepared.request.id));
  expect(
    await f.turns.research.claimApproved(
      f.sessionId,
      prepared.request.id,
      prepared.request.queryHash,
      prepared.contextHash,
    ),
  ).toBe("expired");
  const [expired] = await database.db
    .select()
    .from(conversationResearchRequests)
    .where(eq(conversationResearchRequests.id, prepared.request.id));
  expect(expired).toMatchObject({ status: "expired", proposedQuery: null });
});

it("sends nothing autonomously while a disclosure request in the turn is open", async () => {
  const f = await fixture("What are current public onboarding practices?", {
    input: "Look at my notes.",
  });
  // Prepared before the owner is asked: its egress claim must fail once a request is open.
  const earlier = await f.turns.research.prepare(f.sessionId, {
    question: "What are current public onboarding practices?",
  });
  if (earlier.status !== "generalized") throw new Error("Expected a generalized query.");
  const pending = await f.turns.research.prepare(f.sessionId, {
    question: "Typical notice periods for senior engineers",
    requiresPrivateDisclosure: true,
  });
  if (pending.status !== "approval_required") throw new Error("Expected an approval request.");

  // A reworded copy of the pending question has a different hash and no private overlap.
  expect(
    await f.turns.research.prepare(f.sessionId, {
      question: "Typical notice periods for senior engineers?",
    }),
  ).toMatchObject({ status: "approval_required" });
  expect(
    await f.turns.research.claimGeneralized(f.sessionId, {
      question: "What are current public onboarding practices?",
      outboundQuestion: earlier.outboundQuestion,
      queryHash: earlier.queryHash,
      contextHash: earlier.contextHash,
    }),
  ).toBe("stale");
});

it("binds a denial to the rest of the turn even for a new wording", async () => {
  const f = await fixture("What did Maya Chen earn?", { input: "Look at my notes." });
  const first = await f.turns.research.prepare(f.sessionId, {
    question: "What did Maya Chen earn?",
    requiresPrivateDisclosure: true,
  });
  if (first.status !== "approval_required") throw new Error("Expected an approval request.");
  expect(
    await f.turns.research.decide(
      f.owner,
      f.conversationId,
      first.request.id,
      first.request.queryHash,
      "deny",
    ),
  ).toEqual({ status: "denied" });
  expect(
    await f.turns.research.prepare(f.sessionId, {
      question: "What did Maya Chen earn?",
      requiresPrivateDisclosure: false,
    }),
  ).toMatchObject({ status: "approval_required" });
  expect(
    await f.turns.research.prepare(f.sessionId, {
      question: "What are public oncology treatment options?",
    }),
  ).toMatchObject({ status: "approval_required" });
});

it("blocks later autonomous research without spending a provider call when the budget is low", async () => {
  const f = await fixture("What are current public onboarding practices?", {
    input: "Look at my notes.",
    retrievalBytes: 45_000,
  });
  expect(
    await f.turns.research.prepare(f.sessionId, {
      question: "What are current public onboarding practices?",
    }),
  ).toEqual({ status: "budget" });
});

it("clears an approved payload when the remaining budget cannot be spent", async () => {
  const f = await fixture("What did Maya Chen earn?");
  const prepared = await f.turns.research.prepare(f.sessionId, {
    question: "What did Maya Chen earn?",
    requiresPrivateDisclosure: true,
  });
  if (prepared.status !== "approval_required") throw new Error("Expected an approval request.");
  expect(
    await f.turns.research.decide(
      f.owner,
      f.conversationId,
      prepared.request.id,
      prepared.request.queryHash,
      "approve",
    ),
  ).toEqual({ status: "approved" });
  await database.db
    .update(conversationTurns)
    .set({ retrievalBytes: 45_000 })
    .where(eq(conversationTurns.id, f.turnId));
  expect(
    await f.turns.research.claimApproved(
      f.sessionId,
      prepared.request.id,
      prepared.request.queryHash,
      prepared.contextHash,
    ),
  ).toBe("budget");
  const [request] = await database.db
    .select()
    .from(conversationResearchRequests)
    .where(eq(conversationResearchRequests.id, prepared.request.id));
  expect(request).toMatchObject({ status: "failed", proposedQuery: null });
});

it("counts denied attempts toward the per-turn request limit", async () => {
  const f = await fixture("What did Maya Chen earn?", { input: "Look at my notes." });
  for (const suffix of ["one", "two", "three"]) {
    const prepared = await f.turns.research.prepare(f.sessionId, {
      question: `What did Maya Chen earn ${suffix}?`,
      requiresPrivateDisclosure: true,
    });
    if (prepared.status !== "approval_required") throw new Error("Expected an approval request.");
    await f.turns.research.decide(
      f.owner,
      f.conversationId,
      prepared.request.id,
      prepared.request.queryHash,
      "deny",
    );
  }
  expect(
    await f.turns.research.prepare(f.sessionId, {
      question: "What did Maya Chen earn four?",
    }),
  ).toEqual({ status: "limit" });
});

it("denial, expiry and Stop clear the outbound payload and block later approval", async () => {
  const denied = await fixture("What did Maya Chen earn?");
  const deniedRequest = await denied.turns.research.prepare(denied.sessionId, {
    question: "What did Maya Chen earn?",
    requiresPrivateDisclosure: true,
  });
  if (deniedRequest.status !== "approval_required") throw new Error("Expected a denial fixture.");
  expect(
    await denied.turns.research.decide(
      denied.owner,
      denied.conversationId,
      deniedRequest.request.id,
      deniedRequest.request.queryHash,
      "deny",
    ),
  ).toEqual({ status: "denied" });

  const expired = await fixture("What did Maya Chen earn?");
  const expiredRequest = await expired.turns.research.prepare(expired.sessionId, {
    question: "What did Maya Chen earn?",
    requiresPrivateDisclosure: true,
  });
  if (expiredRequest.status !== "approval_required") throw new Error("Expected an expiry fixture.");
  await database.db
    .update(conversationResearchRequests)
    .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
    .where(eq(conversationResearchRequests.id, expiredRequest.request.id));
  expect(
    await expired.turns.research.decide(
      expired.owner,
      expired.conversationId,
      expiredRequest.request.id,
      expiredRequest.request.queryHash,
      "approve",
    ),
  ).toEqual({ status: "expired" });

  const stopped = await fixture("What did Maya Chen earn?");
  const stoppedRequest = await stopped.turns.research.prepare(stopped.sessionId, {
    question: "What did Maya Chen earn?",
    requiresPrivateDisclosure: true,
  });
  if (stoppedRequest.status !== "approval_required") throw new Error("Expected a Stop fixture.");
  await stopped.turns.finalize(stopped.owner, stopped.conversationId, stopped.turnId, {
    status: "incomplete",
    reason: "cancelled",
    text: "",
    citations: [],
    expectedVersion: 0,
  });
  const [cancelled] = await database.db
    .select()
    .from(conversationResearchRequests)
    .where(eq(conversationResearchRequests.id, stoppedRequest.request.id));
  expect(cancelled).toMatchObject({ status: "cancelled", proposedQuery: null });
  expect(
    await stopped.turns.research.decide(
      stopped.owner,
      stopped.conversationId,
      stoppedRequest.request.id,
      stoppedRequest.request.queryHash,
      "approve",
    ),
  ).toEqual({ status: "conflict" });
});
