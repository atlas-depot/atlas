import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vite-plus/test";
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

const database = setupIndexTestDatabase();

async function fixture(question: string) {
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
    sourceDependencies: [],
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
    text: question,
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
    recent: [],
    summary: null,
    summaryInput: null,
    sources: [],
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

it("generalizes private conversation details before returning an autonomous query", async () => {
  const f = await fixture("Maya Chen works at Northstar Labs.");
  const prepared = await f.turns.research.prepare(f.sessionId, {
    question: "What are public speaking best practices for Maya Chen at Northstar Labs?",
  });
  expect(prepared).toMatchObject({
    status: "generalized",
    outboundQuestion: "What are public speaking best practices for the subject at the subject?",
  });
  if (prepared.status !== "generalized") throw new Error("Expected a generalized query.");
  expect(prepared.outboundQuestion).not.toContain("Maya");
  expect(prepared.outboundQuestion).not.toContain("Northstar");
  expect(
    await f.turns.research.claimGeneralized(f.sessionId, {
      question: "What are public speaking best practices for Maya Chen at Northstar Labs?",
      outboundQuestion: prepared.outboundQuestion,
      queryHash: prepared.queryHash,
      contextHash: prepared.contextHash,
    }),
  ).toBe(true);
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
    requests: [{ id: prepared.request.id, proposedQuery: prepared.request.proposedQuery }],
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
