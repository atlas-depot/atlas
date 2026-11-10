import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vite-plus/test";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import {
  conversationCitations,
  conversationCleanupIntents,
  conversationCreateRequests,
  conversationMessages,
  conversationTurnInputs,
  conversationTurns,
  conversations,
} from "./conversation-schema.ts";

const database = setupIndexTestDatabase();
const payloadHash = "a".repeat(64);

async function conversation(ownerId = randomUUID()) {
  const [row] = await database.db.insert(conversations).values({ ownerId }).returning();
  return row;
}

async function turn(conversationId: string) {
  const [row] = await database.db
    .insert(conversationTurns)
    .values({ conversationId, operationId: randomUUID(), payloadHash })
    .returning();
  return row;
}

async function input(conversationId: string) {
  const [row] = await database.db
    .insert(conversationMessages)
    .values({
      conversationId,
      operationId: randomUUID(),
      payloadHash,
      sequence: 1,
      role: "user",
      deliveryPolicy: "queue",
      text: "Synthetic question",
    })
    .returning();
  return row;
}

it("cannot link another conversation's messages or attempts, even through direct database writes", async () => {
  const first = await conversation();
  const other = await conversation();
  const attempt = await turn(first.id);
  const foreignAttempt = await turn(other.id);
  const foreignInput = await input(other.id);
  await expect(
    database.db.insert(conversationTurnInputs).values({
      conversationId: first.id,
      turnId: attempt.id,
      messageId: foreignInput.id,
      ordinal: 0,
    }),
  ).rejects.toMatchObject({
    cause: { code: "23503", constraint: "conversation_turn_inputs_message_parent_fk" },
  });
  await expect(
    database.db.insert(conversationTurns).values({
      conversationId: first.id,
      operationId: randomUUID(),
      payloadHash,
      retryOfId: foreignAttempt.id,
    }),
  ).rejects.toMatchObject({
    cause: { code: "23503", constraint: "conversation_turns_retry_parent_fk" },
  });
  await expect(
    database.db.insert(conversationMessages).values({
      conversationId: first.id,
      operationId: randomUUID(),
      payloadHash,
      sequence: 1,
      role: "assistant",
      text: "Synthetic answer",
      turnId: foreignAttempt.id,
    }),
  ).rejects.toMatchObject({
    cause: { code: "23503", constraint: "conversation_messages_turn_parent_fk" },
  });
});

it("allows only one running attempt and one finalized message for that attempt", async () => {
  const parent = await conversation();
  const first = await turn(parent.id);
  const second = await turn(parent.id);
  await database.db
    .update(conversationTurns)
    .set({ status: "running" })
    .where(eq(conversationTurns.id, first.id));
  await expect(
    database.other
      .update(conversationTurns)
      .set({ status: "running" })
      .where(eq(conversationTurns.id, second.id)),
  ).rejects.toMatchObject({
    cause: { code: "23505", constraint: "conversation_turns_running_idx" },
  });
  await database.db
    .update(conversationTurns)
    .set({ status: "completed" })
    .where(eq(conversationTurns.id, first.id));
  const output = {
    conversationId: parent.id,
    operationId: randomUUID(),
    payloadHash,
    sequence: 1,
    role: "assistant" as const,
    turnId: first.id,
    text: "Synthetic answer",
  };
  await database.db.insert(conversationMessages).values(output);
  await expect(
    database.other
      .insert(conversationMessages)
      .values({ ...output, operationId: randomUUID(), sequence: 2 }),
  ).rejects.toMatchObject({
    cause: { code: "23505", constraint: "conversation_messages_turn_idx" },
  });
});

it("stores queue or explicit steer on user inputs and rejects assistant delivery policies", async () => {
  const parent = await conversation();
  const first = await input(parent.id);
  expect(first.deliveryPolicy).toBe("queue");
  const [steer] = await database.db
    .insert(conversationMessages)
    .values({
      conversationId: parent.id,
      operationId: randomUUID(),
      payloadHash,
      sequence: 2,
      role: "user",
      deliveryPolicy: "steer",
      text: "Focus on the date.",
    })
    .returning();
  expect(steer.deliveryPolicy).toBe("steer");
  await expect(
    database.db
      .update(conversationMessages)
      .set({ deliveryPolicy: null })
      .where(eq(conversationMessages.id, first.id)),
  ).rejects.toMatchObject({
    cause: { code: "23514", constraint: "conversation_messages_policy_valid" },
  });
  const attempt = await turn(parent.id);
  await expect(
    database.db.insert(conversationMessages).values({
      conversationId: parent.id,
      operationId: randomUUID(),
      payloadHash,
      sequence: 3,
      role: "assistant",
      deliveryPolicy: "queue",
      turnId: attempt.id,
      text: "Answer",
    }),
  ).rejects.toMatchObject({
    cause: { code: "23514", constraint: "conversation_messages_policy_valid" },
  });
});

it("removes conversation content but retains content-free creation and cleanup receipts", async () => {
  const parent = await conversation();
  const attempt = await turn(parent.id);
  const message = await input(parent.id);
  await database.db
    .insert(conversationTurnInputs)
    .values({ conversationId: parent.id, turnId: attempt.id, messageId: message.id, ordinal: 0 });
  const receipt = {
    ownerId: parent.ownerId,
    key: randomUUID(),
    payloadHash,
    conversationId: parent.id,
  };
  await database.db.insert(conversationCreateRequests).values(receipt);
  const allocationOperationId = randomUUID();
  await database.db.insert(conversationCleanupIntents).values({
    allocationOperationId,
    ownerId: parent.ownerId,
    conversationId: parent.id,
    runtimeUrl: "https://synthetic-runtime.example",
    sessionId: null,
  });
  await database.db.delete(conversations).where(eq(conversations.id, parent.id));
  expect(
    await database.db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, parent.id)),
  ).toEqual([]);
  expect(
    await database.db
      .select()
      .from(conversationTurns)
      .where(eq(conversationTurns.conversationId, parent.id)),
  ).toEqual([]);
  expect(
    await database.db
      .select()
      .from(conversationTurnInputs)
      .where(eq(conversationTurnInputs.conversationId, parent.id)),
  ).toEqual([]);
  expect(
    await database.db
      .select()
      .from(conversationCreateRequests)
      .where(eq(conversationCreateRequests.key, receipt.key)),
  ).toEqual([receipt]);
  expect(
    await database.db
      .select()
      .from(conversationCleanupIntents)
      .where(eq(conversationCleanupIntents.allocationOperationId, allocationOperationId)),
  ).toMatchObject([{ conversationId: parent.id, sessionId: null, attempts: 0 }]);
});

it("cannot retain an excerpt on a redacted reference", async () => {
  const parent = await conversation();
  const attempt = await turn(parent.id);
  const [message] = await database.db
    .insert(conversationMessages)
    .values({
      conversationId: parent.id,
      operationId: randomUUID(),
      payloadHash,
      sequence: 1,
      role: "assistant",
      turnId: attempt.id,
      text: "Delivered answer",
    })
    .returning();
  const noteId = randomUUID();
  const citation = {
    conversationId: parent.id,
    messageId: message.id,
    ordinal: 0,
    noteId,
    source: {
      kind: "block" as const,
      noteId,
      version: JSON.stringify(`${noteId}:1`),
      blockId: "meeting",
      headingPath: [],
    },
    excerpt: "Synthetic quote",
  };
  await database.db.insert(conversationCitations).values(citation);
  await expect(
    database.db
      .update(conversationCitations)
      .set({ deleted: true })
      .where(eq(conversationCitations.messageId, message.id)),
  ).rejects.toMatchObject({
    cause: { code: "23514", constraint: "conversation_citations_redaction_valid" },
  });
  await database.db
    .update(conversationCitations)
    .set({ deleted: true, excerpt: null })
    .where(eq(conversationCitations.messageId, message.id));
  expect(
    await database.db
      .select()
      .from(conversationCitations)
      .where(eq(conversationCitations.messageId, message.id)),
  ).toEqual([{ ...citation, deleted: true, excerpt: null }]);
});
