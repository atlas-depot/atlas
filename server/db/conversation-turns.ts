import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lt,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  conversationIdSchema,
  conversationInputIdsSchema,
  conversationTextSchema,
} from "../../shared/conversations.ts";
import { admitConversationInput, expireConversationAdmissions } from "./conversation-admission.ts";
import type { openDatabase } from "./connection.ts";
import { enqueueTurnCleanup } from "./conversation-cleanup.ts";
import { lockContextSources } from "./conversation-contexts.ts";
import {
  byteSize,
  CONTEXT_LIMITS,
  sourceDependenciesSchema,
  unionDependencies,
  type SourceDependency,
} from "../conversation-context.ts";
import { readConversationMessage } from "./conversation-messages.ts";
import {
  conversationPayloadHash,
  lockOwnedConversation,
  finalizeConversationTurn,
  publishConversationAnswer,
  type ConversationTransaction,
} from "./conversation-publication.ts";
import {
  conversations,
  conversationMessages,
  conversationTurns,
  conversationTurnInputs,
  conversationContexts,
} from "./conversation-schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
const inputSchema = z.strictObject({
  text: conversationTextSchema.refine((text) => text.trim().length > 0),
  policy: z.enum(["queue", "steer"]).default("queue"),
});
/** One owner may hold this many running answers across all conversations. */
export const MAX_RUNNING_TURNS_PER_OWNER = 3;
const MAX_TURN_INPUTS = 100;
/**
 * Combined UTF-8 input budget, leaving room for 8 KB recent context, 4 KB encoded summary
 * and grouping/framing in the 24 KB prompt. An oversized first input gets explicit recovery.
 */
export const MAX_TURN_INPUT_BYTES = 10_000;
const attemptSchema = z.strictObject({
  inputIds: conversationInputIdsSchema,
  retryOfId: conversationIdSchema.optional(),
});

async function turnInputs(tx: ConversationTransaction, turnId: string) {
  return tx
    .select({ messageId: conversationTurnInputs.messageId, steer: conversationTurnInputs.steer })
    .from(conversationTurnInputs)
    .where(eq(conversationTurnInputs.turnId, turnId))
    .orderBy(asc(conversationTurnInputs.ordinal));
}

/** The first input always opens an attempt on its own, even above the grouping bound. */
function boundedOpeningCount(inputs: readonly { bytes: number }[]) {
  let bytes = 0;
  for (const [index, input] of inputs.entries()) {
    bytes += input.bytes;
    if (index > 0 && bytes > MAX_TURN_INPUT_BYTES) return index;
  }
  return inputs.length;
}

/** Call with the conversation lock held, immediately before inserting a running attempt. */
async function ownerAtCapacity(tx: ConversationTransaction, owner: string) {
  // Serialize the owner-wide count across conversations and API processes.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${owner}, 71))`);
  const active = await tx
    .select({ id: conversationTurns.id })
    .from(conversationTurns)
    .innerJoin(conversations, eq(conversations.id, conversationTurns.conversationId))
    .where(and(eq(conversations.ownerId, owner), eq(conversationTurns.status, "running")))
    .limit(MAX_RUNNING_TURNS_PER_OWNER);
  return active.length >= MAX_RUNNING_TURNS_PER_OWNER;
}

/** Internal persistence only. Callers execute models after durable admission/runtime binding. */
export function createConversationTurns(db: Database) {
  function unconsumedInputs(
    reader: Pick<Database, "select">,
    id: string | typeof conversations.id,
  ) {
    return reader
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, id),
          eq(conversationMessages.role, "user"),
          notExists(
            reader
              .select({ id: conversationTurnInputs.messageId })
              .from(conversationTurnInputs)
              .where(eq(conversationTurnInputs.messageId, conversationMessages.id)),
          ),
        ),
      );
  }

  return {
    /**
     * Record all retrieved evidence before it reaches the model, even if never cited.
     * Search tool calls in one turn can run concurrently. Serialize them per session so each
     * call merges its sources and byte count instead of rejecting the other call.
     */
    async recordSearch(sessionId: string, sources: SourceDependency[], output: unknown) {
      return db.transaction(async (tx) => {
        // Short lock only. No provider work runs inside this transaction.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 72))`);
        const [snapshot] = await tx
          .select({ turn: conversationTurns, owner: conversations.ownerId })
          .from(conversationTurns)
          .innerJoin(conversations, eq(conversations.id, conversationTurns.conversationId))
          .where(
            and(
              eq(conversationTurns.sessionId, sessionId),
              eq(conversationTurns.status, "running"),
            ),
          );
        if (!snapshot) return { status: "unavailable" as const };
        // Past the lineage limit the search is refused as over budget, not as an error.
        const dependencies = unionDependencies(snapshot.turn.sourceDependencies, sources);
        if (!sourceDependenciesSchema.safeParse(dependencies).success)
          return { status: "budget" as const };
        if (!(await lockContextSources(tx, snapshot.owner, dependencies)))
          return { status: "unavailable" as const };
        const parent = await lockOwnedConversation(
          tx,
          snapshot.owner,
          snapshot.turn.conversationId,
        );
        if (!parent) return { status: "unavailable" as const };
        const [context] = await tx
          .select()
          .from(conversationContexts)
          .where(
            and(
              eq(conversationContexts.turnId, snapshot.turn.id),
              eq(conversationContexts.state, "ready"),
            ),
          );
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.id, snapshot.turn.id),
              eq(conversationTurns.status, "running"),
            ),
          );
        if (!context || !turn) return { status: "unavailable" as const };
        const merged = unionDependencies(turn.sourceDependencies, dependencies);
        if (!sourceDependenciesSchema.safeParse(merged).success)
          return { status: "budget" as const };
        const bytes = turn.retrievalBytes + byteSize(output);
        if (bytes > CONTEXT_LIMITS.retrievalBytes) return { status: "budget" as const };
        await tx
          .update(conversationTurns)
          .set({ sourceDependencies: merged, retrievalBytes: bytes })
          .where(eq(conversationTurns.id, turn.id));
        await tx
          .update(conversationContexts)
          .set({ sources: merged })
          .where(eq(conversationContexts.turnId, turn.id));
        return { status: "recorded" as const };
      });
    },

    /**
     * Checked before every chat model call, including after a tool or a steer. Existence is
     * deliberate: an in-flight answer may finish against the revision it used and is marked
     * stale later (#71). New context reconstruction requires current versions.
     */
    async contextAuthorized(sessionId: string) {
      const rows = await db
        .select({
          sources: conversationTurns.sourceDependencies,
          complete: conversationTurns.provenanceComplete,
          owner: conversations.ownerId,
        })
        .from(conversationTurns)
        .innerJoin(conversations, eq(conversations.id, conversationTurns.conversationId))
        .innerJoin(conversationContexts, eq(conversationContexts.turnId, conversationTurns.id))
        .where(
          and(
            eq(conversationTurns.sessionId, sessionId),
            eq(conversationTurns.status, "running"),
            eq(conversationContexts.state, "ready"),
          ),
        )
        .limit(2);
      const row = rows.length === 1 ? rows[0] : undefined;
      const sources = row ? sourceDependenciesSchema.safeParse(row.sources) : undefined;
      return (
        !!row &&
        row.complete &&
        !!sources?.success &&
        db.transaction((tx) => lockContextSources(tx, row.owner, sources.data))
      );
    },
    /** Replays return the saved input; only a new message reserves an admission. */
    async acceptInput(
      owner: string,
      conversationId: string,
      operationId: string,
      value: z.input<typeof inputSchema>,
    ) {
      const input = inputSchema.parse(value);
      const operation = conversationIdSchema.parse(operationId);
      const payloadHash = conversationPayloadHash([input.text, input.policy]);
      await expireConversationAdmissions(db);
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        const [existing] = await tx
          .select()
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, parent.id),
              eq(conversationMessages.operationId, operation),
            ),
          );
        if (existing)
          return existing.role === "user" && existing.payloadHash === payloadHash
            ? {
                status: "saved" as const,
                value: (await readConversationMessage(tx, parent.id, existing.id))!,
              }
            : { status: "conflict" as const };
        const [running] =
          input.policy === "steer"
            ? await tx
                .select({ id: conversationTurns.id })
                .from(conversationTurns)
                .where(
                  and(
                    eq(conversationTurns.conversationId, parent.id),
                    eq(conversationTurns.status, "running"),
                  ),
                )
            : [];
        const joined = running ? await turnInputs(tx, running.id) : [];
        // Refuse rather than quietly queue a steer the running attempt cannot take.
        if (joined.length >= MAX_TURN_INPUTS) return { status: "policy_unsupported" as const };
        const admission = await admitConversationInput(tx, owner);
        if (!admission.allowed)
          return {
            status: "rate_limited" as const,
            retryAfterSeconds: admission.retryAfterSeconds,
          };
        const [message] = await tx
          .insert(conversationMessages)
          .values({
            conversationId: parent.id,
            operationId: operation,
            payloadHash,
            sequence: parent.nextSequence,
            role: "user",
            deliveryPolicy: input.policy,
            text: input.text,
          })
          .returning();
        await tx
          .update(conversations)
          .set({ nextSequence: parent.nextSequence + 1, updatedAt: new Date().toISOString() })
          .where(eq(conversations.id, parent.id));
        if (input.policy === "steer" && running) {
          // The input joins the running attempt here, under the conversation lock, so it can
          // never also be picked up as a queued input for a later answer.
          await tx.insert(conversationTurnInputs).values({
            conversationId: parent.id,
            turnId: running.id,
            messageId: message!.id,
            ordinal: joined.length,
            steer: true,
          });
          // Any reader that inspected the attempt before this input must not publish: its
          // observation predates the steer. The version bump fences that finalization.
          await tx
            .update(conversationTurns)
            .set({ checkpointVersion: sql`${conversationTurns.checkpointVersion} + 1` })
            .where(eq(conversationTurns.id, running.id));
        }
        return {
          status: "saved" as const,
          value: (await readConversationMessage(tx, parent.id, message!.id))!,
        };
      });
    },

    /**
     * Starts one attempt over every accepted input no attempt has consumed yet. The running
     * index and this lock make a repeated or concurrent call resolve to the same attempt.
     */
    async startNext(owner: string, conversationId: string) {
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        const [running] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.conversationId, parent.id),
              eq(conversationTurns.status, "running"),
            ),
          );
        if (running) return { status: "busy" as const, turn: running };
        if (parent.queuePaused) return { status: "paused" as const };
        const waiting = await tx
          .select({
            id: conversationMessages.id,
            bytes: sql<number>`octet_length(${conversationMessages.text})`.mapWith(Number),
          })
          .from(conversationMessages)
          .where(inArray(conversationMessages.id, unconsumedInputs(tx, parent.id)))
          .orderBy(asc(conversationMessages.sequence))
          .limit(MAX_TURN_INPUTS);
        if (waiting.length === 0) return { status: "idle" as const };
        if (await ownerAtCapacity(tx, owner)) return { status: "owner_busy" as const };
        const inputIds = waiting.slice(0, boundedOpeningCount(waiting)).map((input) => input.id);
        const [turn] = await tx
          .insert(conversationTurns)
          .values({
            conversationId: parent.id,
            operationId: randomUUID(),
            payloadHash: conversationPayloadHash([inputIds, null]),
            status: "running",
            runningText: "",
          })
          .returning();
        await tx.insert(conversationTurnInputs).values(
          inputIds.map((messageId, ordinal) => ({
            conversationId: parent.id,
            turnId: turn!.id,
            messageId,
            ordinal,
          })),
        );
        return { status: "started" as const, turn: turn! };
      });
    },

    /** The running attempt with the input text its runtime deliveries are rebuilt from. */
    async dispatchState(owner: string, conversationId: string) {
      return db.transaction(async (tx) => {
        const [parent] = await tx
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.id, conversationIdSchema.parse(conversationId)),
              eq(conversations.ownerId, owner),
            ),
          );
        if (!parent) return undefined;
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.conversationId, parent.id),
              eq(conversationTurns.status, "running"),
            ),
          );
        if (!turn) return undefined;
        const inputs = await tx
          .select({
            id: conversationMessages.id,
            text: conversationMessages.text,
            steer: conversationTurnInputs.steer,
            deliveryId: conversationTurnInputs.deliveryId,
          })
          .from(conversationTurnInputs)
          .innerJoin(
            conversationMessages,
            eq(conversationMessages.id, conversationTurnInputs.messageId),
          )
          .where(eq(conversationTurnInputs.turnId, turn.id))
          .orderBy(asc(conversationTurnInputs.ordinal));
        return { turn, inputs };
      });
    },

    /** Input identities of one owned attempt, in the order it consumed them. */
    async attemptInputs(owner: string, conversationId: string, turnId: string) {
      return db.transaction(async (tx) => {
        const [turn] = await tx
          .select({ id: conversationTurns.id })
          .from(conversationTurns)
          .innerJoin(conversations, eq(conversations.id, conversationTurns.conversationId))
          .where(
            and(
              eq(conversations.ownerId, owner),
              eq(conversations.id, conversationIdSchema.parse(conversationId)),
              eq(conversationTurns.id, conversationIdSchema.parse(turnId)),
            ),
          );
        return turn ? (await turnInputs(tx, turn.id)).map((input) => input.messageId) : undefined;
      });
    },

    /** Records a runtime receipt only while the attempt is still the running one. */
    async recordDelivery(
      owner: string,
      conversationId: string,
      turnId: string,
      deliveryId: string,
      steerMessageId?: string,
    ) {
      const delivery = z.string().min(1).max(512).parse(deliveryId);
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return false;
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.id, conversationIdSchema.parse(turnId)),
              eq(conversationTurns.conversationId, parent.id),
              eq(conversationTurns.status, "running"),
            ),
          );
        if (!turn) return false;
        if (steerMessageId)
          await tx
            .update(conversationTurnInputs)
            .set({ deliveryId: delivery })
            .where(
              and(
                eq(conversationTurnInputs.turnId, turn.id),
                eq(conversationTurnInputs.messageId, conversationIdSchema.parse(steerMessageId)),
                eq(conversationTurnInputs.steer, true),
                isNull(conversationTurnInputs.deliveryId),
              ),
            );
        else if (turn.deliveryId === null)
          await tx
            .update(conversationTurns)
            .set({ deliveryId: delivery })
            .where(eq(conversationTurns.id, turn.id));
        return true;
      });
    },

    /**
     * Resolves the verified owner of the running attempt bound to a runtime session. The
     * runtime uses this instead of any owner or note identity a model could supply.
     */
    async ownerOfSession(sessionId: string) {
      const rows = await db
        .select({ ownerId: conversations.ownerId })
        .from(conversationTurns)
        .innerJoin(conversations, eq(conversations.id, conversationTurns.conversationId))
        .where(
          and(
            eq(conversationTurns.sessionId, z.string().min(1).max(512).parse(sessionId)),
            eq(conversationTurns.status, "running"),
          ),
        )
        .limit(2);
      return rows.length === 1 ? rows[0]!.ownerId : undefined;
    },

    /** A saved input may have no running turn yet, including after the owner reached the cap. */
    async runnableQueues(limit: number) {
      const running = db
        .select({ id: conversationTurns.conversationId })
        .from(conversationTurns)
        .where(eq(conversationTurns.status, "running"));
      const fullOwners = db
        .select({ owner: conversations.ownerId })
        .from(conversations)
        .where(inArray(conversations.id, running))
        .groupBy(conversations.ownerId)
        .having(gte(count(), MAX_RUNNING_TURNS_PER_OWNER));
      return db
        .select({ conversationId: conversations.id, ownerId: conversations.ownerId })
        .from(conversations)
        .where(
          and(
            eq(conversations.queuePaused, false),
            notInArray(conversations.id, running),
            notInArray(conversations.ownerId, fullOwners),
            exists(unconsumedInputs(db, conversations.id)),
          ),
        )
        .orderBy(asc(conversations.updatedAt), asc(conversations.id))
        .limit(z.number().int().min(1).max(100).parse(limit));
    },

    /** Running attempts nobody has observed recently, oldest first, for maintenance. */
    async unobserved(limit: number, idleMs: number) {
      const size = z.number().int().min(1).max(100).parse(limit);
      const idle = z.number().int().min(0).parse(idleMs);
      return db
        .select({
          ownerId: conversations.ownerId,
          conversationId: conversations.id,
          turnId: conversationTurns.id,
        })
        .from(conversationTurns)
        .innerJoin(conversations, eq(conversations.id, conversationTurns.conversationId))
        .where(
          and(
            eq(conversationTurns.status, "running"),
            lt(conversationTurns.updatedAt, sql`now() - make_interval(secs => ${idle / 1000})`),
          ),
        )
        .orderBy(asc(conversationTurns.updatedAt))
        .limit(size);
    },

    /** Marks an attempt as observed so maintenance rotates to older work. */
    async touch(turnId: string) {
      await db
        .update(conversationTurns)
        .set({ updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(conversationTurns.id, conversationIdSchema.parse(turnId)),
            eq(conversationTurns.status, "running"),
          ),
        );
    },

    async startAttempt(
      owner: string,
      conversationId: string,
      operationId: string,
      value: z.input<typeof attemptSchema>,
    ) {
      const input = attemptSchema.parse(value);
      const operation = conversationIdSchema.parse(operationId);
      const payloadHash = conversationPayloadHash([input.inputIds, input.retryOfId ?? null]);
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        const [existing] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.conversationId, parent.id),
              eq(conversationTurns.operationId, operation),
            ),
          );
        if (existing)
          return existing.payloadHash === payloadHash
            ? { status: "saved" as const, value: existing }
            : { status: "conflict" as const };
        if (parent.queuePaused) return { status: "paused" as const };
        const [running] = await tx
          .select({ id: conversationTurns.id })
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.conversationId, parent.id),
              eq(conversationTurns.status, "running"),
            ),
          );
        if (running) return { status: "busy" as const, turnId: running.id };
        const messages = await tx
          .select({
            id: conversationMessages.id,
            role: conversationMessages.role,
            bytes: sql<number>`octet_length(${conversationMessages.text})`.mapWith(Number),
          })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, parent.id),
              inArray(conversationMessages.id, input.inputIds),
            ),
          )
          .orderBy(asc(conversationMessages.sequence));
        if (
          messages.length !== input.inputIds.length ||
          messages.some(
            (message, index) => message.role !== "user" || message.id !== input.inputIds[index],
          )
        )
          return { status: "conflict" as const };
        let openingCount = boundedOpeningCount(messages);
        if (input.retryOfId) {
          const [original] = await tx
            .select()
            .from(conversationTurns)
            .where(
              and(
                eq(conversationTurns.id, input.retryOfId),
                eq(conversationTurns.conversationId, parent.id),
              ),
            );
          if (original?.status !== "incomplete") return { status: "conflict" as const };
          const links = await turnInputs(tx, original.id);
          if (
            links.length !== messages.length ||
            links.some((link, index) => link.messageId !== input.inputIds[index])
          )
            return { status: "conflict" as const };
          // Replay steers individually, including on retries of a previously flattened attempt.
          const firstSteer = links.findIndex((link) => link.steer);
          if (firstSteer !== -1) openingCount = Math.min(openingCount, firstSteer);
        } else {
          if (openingCount !== messages.length) return { status: "conflict" as const };
          const consumed = await tx
            .select()
            .from(conversationTurnInputs)
            .where(
              and(
                eq(conversationTurnInputs.conversationId, parent.id),
                inArray(conversationTurnInputs.messageId, input.inputIds),
              ),
            );
          if (consumed.length) return { status: "conflict" as const };
        }
        // A retry is a running answer like any other and counts against the owner's cap.
        if (await ownerAtCapacity(tx, owner)) return { status: "owner_busy" as const };
        // It can also start a summary, so it spends the same send budget as a new message.
        if (input.retryOfId) {
          const admission = await admitConversationInput(tx, owner);
          if (!admission.allowed)
            return {
              status: "rate_limited" as const,
              retryAfterSeconds: admission.retryAfterSeconds,
            };
        }
        const [turn] = await tx
          .insert(conversationTurns)
          .values({
            conversationId: parent.id,
            operationId: operation,
            payloadHash,
            status: "running",
            runningText: "",
            retryOfId: input.retryOfId,
          })
          .returning();
        await tx.insert(conversationTurnInputs).values(
          input.inputIds.map((messageId, ordinal) => ({
            conversationId: parent.id,
            turnId: turn!.id,
            messageId,
            ordinal,
            steer: ordinal >= openingCount,
          })),
        );
        return { status: "saved" as const, value: turn! };
      });
    },

    async checkpoint(
      owner: string,
      conversationId: string,
      turnId: string,
      expectedVersion: number,
      text: string,
    ) {
      const id = conversationIdSchema.parse(turnId);
      z.number().int().min(0).max(2_147_483_646).parse(expectedVersion);
      conversationTextSchema.parse(text);
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(eq(conversationTurns.id, id), eq(conversationTurns.conversationId, parent.id)),
          );
        if (!turn) return { status: "not_found" as const };
        if (turn.status !== "running") return { status: "conflict" as const };
        // Text observed before a source was deleted must not be saved after the deletion.
        const [context] = await tx
          .select({ state: conversationContexts.state })
          .from(conversationContexts)
          .where(eq(conversationContexts.turnId, turn.id));
        if (context?.state === "recovery") return { status: "conflict" as const };
        if (turn.checkpointVersion === expectedVersion + 1 && turn.runningText === text)
          return { status: "saved" as const, version: turn.checkpointVersion };
        if (turn.checkpointVersion !== expectedVersion) return { status: "conflict" as const };
        await tx
          .update(conversationTurns)
          .set({
            runningText: text,
            checkpointVersion: expectedVersion + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(conversationTurns.id, id));
        return { status: "saved" as const, version: expectedVersion + 1 };
      });
    },

    finalize: finalizeConversationTurn(db),

    async stop(owner: string, conversationId: string) {
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.conversationId, parent.id),
              eq(conversationTurns.status, "running"),
            ),
          );
        // Capture the summary session before publication removes this attempt's context row.
        const [summaryContext] = turn
          ? await tx
              .select({ operationId: conversationContexts.operationId })
              .from(conversationContexts)
              .where(eq(conversationContexts.turnId, turn.id))
          : [];
        const message = turn
          ? await publishConversationAnswer(tx, parent, turn, {
              status: "incomplete",
              reason: "cancelled",
              text: turn.runningText ?? "",
              citations: [],
              expectedVersion: turn.checkpointVersion,
            })
          : undefined;
        if (turn) await enqueueTurnCleanup(tx, owner, turn);
        await tx
          .update(conversations)
          .set({ queuePaused: true, updatedAt: new Date().toISOString() })
          .where(eq(conversations.id, parent.id));
        return {
          status: "paused" as const,
          message,
          allocationOperationId: turn?.allocationOperationId ?? null,
          summaryOperationId: summaryContext?.operationId ?? null,
        };
      });
    },

    async resume(owner: string, conversationId: string) {
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, conversationId);
        if (!parent) return { status: "not_found" as const };
        await tx
          .update(conversations)
          .set({ queuePaused: false, updatedAt: new Date().toISOString() })
          .where(eq(conversations.id, parent.id));
        return { status: "resumed" as const };
      });
    },
  };
}
