import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vite-plus/test";
import { setupIndexTestDatabase } from "./index-test-database.ts";
import { conversationTurns } from "./conversation-schema.ts";
import { createConversationStore } from "./conversations.ts";
import { createConversationTurns } from "./conversation-turns.ts";
import { createConversationContextStore } from "./conversation-contexts.ts";

const id = randomUUID();
const inputId = randomUUID();
const answerId = randomUUID();
const turnId = randomUUID();
const owner = "synthetic-upgrade-owner";
const database = setupIndexTestDatabase(async ({ db }) => {
  const names = [
    "0000_create-notes",
    "0001_organize-runs",
    "0002_organize-usage",
    "0003_note-create-idempotency",
    "0004_note-documents",
    "0005_ai-note-drafts",
    "0006_note-index",
    "0007_search-admission",
    "0008_conversation-records",
    "0009_conversation-delivery",
  ];
  for (const name of names)
    await db.execute(
      sql.raw(await readFile(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8")),
    );
  await db.execute(
    sql`INSERT INTO conversations (id, owner_id, next_sequence) VALUES (${id}, ${owner}, 3)`,
  );
  await db.execute(
    sql`INSERT INTO conversation_turns (id, conversation_id, operation_id, payload_hash, status) VALUES (${turnId}, ${id}, ${randomUUID()}, 'synthetic', 'no-support')`,
  );
  await db.execute(
    sql`INSERT INTO conversation_messages (id, conversation_id, operation_id, payload_hash, sequence, role, delivery_policy, text) VALUES (${inputId}, ${id}, ${randomUUID()}, 'synthetic', 1, 'user', 'queue', 'What did we decide?')`,
  );
  await db.execute(
    sql`INSERT INTO conversation_turn_inputs (conversation_id, turn_id, message_id, ordinal) VALUES (${id}, ${turnId}, ${inputId}, 0)`,
  );
  await db.execute(
    sql`INSERT INTO conversation_messages (id, conversation_id, operation_id, payload_hash, sequence, role, text, turn_id) VALUES (${answerId}, ${id}, ${randomUUID()}, 'synthetic', 2, 'assistant', 'An already delivered historical answer.', ${turnId})`,
  );
  await db.execute(
    sql.raw(
      await readFile(
        new URL("../../drizzle/0010_conversation-context.sql", import.meta.url),
        "utf8",
      ),
    ),
  );
});

it("upgrades existing history without rewriting identities or inventing complete source provenance", async () => {
  const history = await createConversationStore(database.db).messages(owner, id, { limit: 50 });
  expect(history?.messages).toMatchObject([
    { id: inputId, sequence: 1, role: "user", text: "What did we decide?" },
    {
      id: answerId,
      sequence: 2,
      role: "assistant",
      text: "An already delivered historical answer.",
      inputIds: [inputId],
    },
  ]);
  const [legacy] = await database.db
    .select()
    .from(conversationTurns)
    .where(eq(conversationTurns.id, turnId));
  expect(legacy).toMatchObject({
    provenanceComplete: false,
    sourceDependencies: [],
    retrievalBytes: 0,
  });
  const turns = createConversationTurns(database.db);
  await turns.acceptInput(owner, id, randomUUID(), { text: "And why was that?" });
  const next = await turns.startNext(owner, id);
  if (next.status !== "started") throw new Error("New turn did not start");
  // Unknown lineage is never model context, and it does not block the follow-up either.
  const context = await createConversationContextStore(database.db).prepare(
    owner,
    id,
    next.turn.id,
    "https://runtime.example.test",
  );
  expect(context).toMatchObject({ state: "ready", summary: null, sources: [] });
  expect(context?.recent.map(({ text }) => text)).toEqual(["What did we decide?"]);
  expect((await turns.dispatchState(owner, id))?.turn.contextRecovery).toBeNull();
});
