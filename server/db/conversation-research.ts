import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CONTEXT_LIMITS,
  contextMessagesSchema,
  sourceDependenciesSchema,
  byteSize,
  type SourceDependency,
} from "../conversation-context.ts";
import { inspectResearchQuestion } from "../research-disclosure.ts";
import { conversationIdSchema } from "../../shared/conversations.ts";
import { noteContentPlainText } from "../../shared/document.ts";
import {
  researchDisclosureRequestsSchema,
  type ResearchDisclosureRequest,
} from "../../shared/research.ts";
import type { openDatabase } from "./connection.ts";
import { lockContextSources } from "./conversation-contexts.ts";
import {
  conversationContexts,
  conversationMessages,
  conversationResearchRequests,
  conversations,
  conversationTurnInputs,
  conversationTurns,
  type ConversationResearchRequestStatus,
} from "./conversation-schema.ts";
import { lockOwnedConversation, type ConversationTransaction } from "./conversation-publication.ts";
import { noteTag } from "./notes.ts";
import { notes } from "./schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
const requestQuestionSchema = z.string().trim().min(1).max(500);
const queryHash = (question: string) => createHash("sha256").update(question).digest("hex");
const RESEARCH_REQUEST_TTL_MS = 120_000;
const RESEARCH_REQUEST_POLL_MS = 500;
const MAX_RESEARCH_REQUESTS_PER_TURN = 3;
const MAX_PRIVATE_NOTE_COUNT = 100;
const MAX_PRIVATE_NOTE_BYTES = 250_000;
/** Do not spend a paid provider call when the answer has no room for useful evidence. */
const MIN_RESEARCH_BUDGET_BYTES = 4_000;

type ContextSnapshot = {
  ownerId: string;
  conversationId: string;
  turnId: string;
  sourceDependencies: SourceDependency[];
  contextHash: string;
  retrievalBytes: number;
  privateTexts: string[];
  contextUncertain: boolean;
};

type ContextLookup = {
  sessionId?: string;
  turnId?: string;
  conversationId?: string;
};

type ResearchDecision = "pending" | "approved" | "denied" | "cancelled" | "expired" | "stale";

const openStatuses = ["pending", "approved"] as const;
const terminalStatuses = [
  "denied",
  "expired",
  "cancelled",
  "stale",
  "completed",
  "failed",
] as const;

type RequestWriter = Pick<Database, "update">;

/** One guarded terminal write. A stale status never overwrites a claimed or decided row. */
async function settleRequest(
  tx: RequestWriter,
  id: string,
  status: ConversationResearchRequestStatus,
  allowedFrom: readonly ConversationResearchRequestStatus[],
) {
  await tx
    .update(conversationResearchRequests)
    .set({ status, proposedQuery: null, decidedAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(conversationResearchRequests.id, id),
        inArray(conversationResearchRequests.status, allowedFrom),
      ),
    );
}

function compareDependencies(left: SourceDependency[], right: SourceDependency[]) {
  const sorted = (sources: SourceDependency[]) =>
    [...sources]
      .map((source) => `${source.noteId}\n${source.version}`)
      .sort()
      .join("\n");
  return sorted(left) === sorted(right);
}

/** Caller takes the source locks before this function locks the parent conversation. */
async function readResearchContext(
  tx: ConversationTransaction,
  lookup: ContextLookup,
): Promise<ContextSnapshot | undefined> {
  const conditions = [
    eq(conversationTurns.status, "running"),
    eq(conversationContexts.state, "ready"),
  ];
  if (lookup.sessionId) conditions.push(eq(conversationTurns.sessionId, lookup.sessionId));
  if (lookup.turnId) conditions.push(eq(conversationTurns.id, lookup.turnId));
  if (lookup.conversationId)
    conditions.push(eq(conversationTurns.conversationId, lookup.conversationId));

  const rows = await tx
    .select({
      turnId: conversationTurns.id,
      conversationId: conversationTurns.conversationId,
      ownerId: conversations.ownerId,
      sourceDependencies: conversationTurns.sourceDependencies,
      provenanceComplete: conversationTurns.provenanceComplete,
      retrievalBytes: conversationTurns.retrievalBytes,
      summary: conversationContexts.summary,
      recent: conversationContexts.recent,
    })
    .from(conversationTurns)
    .innerJoin(conversations, eq(conversations.id, conversationTurns.conversationId))
    .innerJoin(conversationContexts, eq(conversationContexts.turnId, conversationTurns.id))
    .where(and(...conditions))
    .limit(2);
  const row = rows.length === 1 ? rows[0] : undefined;
  if (!row || !row.provenanceComplete) return undefined;
  const parsedDependencies = sourceDependenciesSchema.safeParse(row.sourceDependencies);
  const recent = contextMessagesSchema.safeParse(row.recent);
  if (!parsedDependencies.success || !recent.success) return undefined;

  const sourceIds = [...new Set(parsedDependencies.data.map(({ noteId }) => noteId))].sort();
  if (!(await lockContextSources(tx, row.ownerId, parsedDependencies.data))) return undefined;
  if (!(await lockOwnedConversation(tx, row.ownerId, row.conversationId))) return undefined;

  const [turn] = await tx
    .select({
      id: conversationTurns.id,
      sourceDependencies: conversationTurns.sourceDependencies,
      provenanceComplete: conversationTurns.provenanceComplete,
    })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.id, row.turnId),
        eq(conversationTurns.conversationId, row.conversationId),
        eq(conversationTurns.status, "running"),
      ),
    )
    .for("share");
  const [context] = await tx
    .select({
      operationId: conversationContexts.operationId,
      summary: conversationContexts.summary,
      recent: conversationContexts.recent,
    })
    .from(conversationContexts)
    .where(
      and(eq(conversationContexts.turnId, row.turnId), eq(conversationContexts.state, "ready")),
    )
    .for("share");
  if (!turn || !context || !turn.provenanceComplete) return undefined;

  const dependencies = sourceDependenciesSchema.safeParse(turn.sourceDependencies);
  const contextRecent = contextMessagesSchema.safeParse(context.recent);
  if (!dependencies.success || !contextRecent.success) return undefined;
  if (!compareDependencies(parsedDependencies.data, dependencies.data)) return undefined;

  const noteMetadata = sourceIds.length
    ? await tx
        .select({
          id: notes.id,
          revision: notes.revision,
          title: notes.title,
          bytes:
            sql<number>`octet_length(${notes.content}::text) + octet_length(${notes.title})`.mapWith(
              Number,
            ),
        })
        .from(notes)
        .where(and(eq(notes.ownerId, row.ownerId), inArray(notes.id, sourceIds)))
        .orderBy(asc(notes.id))
    : [];
  if (noteMetadata.length !== sourceIds.length) return undefined;

  const currentVersions = new Map(
    noteMetadata.map((note) => [note.id, noteTag(note.id, note.revision)]),
  );
  const sourcesCurrent = dependencies.data.every(
    (source) => currentVersions.get(source.noteId) === source.version,
  );
  const noteBytes = noteMetadata.reduce((total, note) => total + note.bytes, 0);
  const privateContextTooLarge =
    noteMetadata.length > MAX_PRIVATE_NOTE_COUNT || noteBytes > MAX_PRIVATE_NOTE_BYTES;

  const inputs = await tx
    .select({ id: conversationMessages.id, text: conversationMessages.text })
    .from(conversationTurnInputs)
    .innerJoin(conversationMessages, eq(conversationMessages.id, conversationTurnInputs.messageId))
    .where(eq(conversationTurnInputs.turnId, row.turnId))
    .orderBy(asc(conversationTurnInputs.ordinal));

  const noteContent =
    privateContextTooLarge || sourceIds.length === 0
      ? []
      : await tx
          .select({ id: notes.id, title: notes.title, content: notes.content })
          .from(notes)
          .where(and(eq(notes.ownerId, row.ownerId), inArray(notes.id, sourceIds)))
          .orderBy(asc(notes.id));
  if (!privateContextTooLarge && noteContent.length !== sourceIds.length) return undefined;

  const contextHash = createHash("sha256")
    .update(
      JSON.stringify({
        ownerId: row.ownerId,
        conversationId: row.conversationId,
        turnId: row.turnId,
        contextOperationId: context.operationId,
        summary: context.summary,
        recent: contextRecent.data,
        inputs,
      }),
    )
    .digest("hex");

  const noteTexts = noteContent.flatMap(({ title, content }) => [
    title,
    noteContentPlainText(content),
  ]);
  return {
    ownerId: row.ownerId,
    conversationId: row.conversationId,
    turnId: row.turnId,
    sourceDependencies: dependencies.data,
    contextHash,
    retrievalBytes: row.retrievalBytes,
    // Notes, summary, recent history and this turn's inputs are all transcript evidence.
    privateTexts: [
      ...(context.summary ? [context.summary] : []),
      ...contextRecent.data.map(({ text }) => text),
      ...inputs.map(({ text }) => text),
      ...noteTexts,
    ],
    contextUncertain: !sourcesCurrent || privateContextTooLarge,
  };
}

function disclosureRequest(
  row: typeof conversationResearchRequests.$inferSelect,
): ResearchDisclosureRequest {
  return researchDisclosureRequestsSchema.shape.requests.element.parse({
    id: row.id,
    proposedQuery: row.proposedQuery,
    queryHash: row.queryHash,
    status: row.status === "approved" ? "approved" : "pending",
    expiresAt: new Date(row.expiresAt).toISOString(),
  });
}

async function expireRequestRows(tx: ConversationTransaction, turnId: string) {
  await tx
    .update(conversationResearchRequests)
    .set({ status: "expired", proposedQuery: null, decidedAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(conversationResearchRequests.turnId, turnId),
        inArray(conversationResearchRequests.status, ["pending", "approved"]),
        lt(conversationResearchRequests.expiresAt, sql`clock_timestamp()`),
      ),
    );
}

/** Reserves one paid research attempt in the turn before any provider call can start. */
async function reserveResearchAttempt(tx: ConversationTransaction, turnId: string) {
  const [row] = await tx
    .update(conversationTurns)
    .set({ researchAttempts: sql`${conversationTurns.researchAttempts} + 1` })
    .where(
      and(
        eq(conversationTurns.id, turnId),
        lt(conversationTurns.researchAttempts, MAX_RESEARCH_REQUESTS_PER_TURN),
      ),
    )
    .returning({ attempts: conversationTurns.researchAttempts });
  return row !== undefined;
}

function sleep(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Research approval wait cancelled.", "AbortError"));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Research approval wait cancelled.", "AbortError"));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function createConversationResearchStore(db: Database) {
  async function pollDecision(
    sessionId: string,
    requestId: string,
    expectedHash: string,
  ): Promise<ResearchDecision> {
    const id = conversationIdSchema.parse(requestId);
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ request: conversationResearchRequests })
        .from(conversationResearchRequests)
        .where(
          and(
            eq(conversationResearchRequests.id, id),
            eq(conversationResearchRequests.queryHash, expectedHash),
          ),
        )
        .for("update");
      if (!row) return "stale";
      // Read the turn separately. Locking both rows here can deadlock against claimApproved,
      // which holds a share lock on the turn before updating the request.
      const [turn] = await tx
        .select({ sessionId: conversationTurns.sessionId, status: conversationTurns.status })
        .from(conversationTurns)
        .where(eq(conversationTurns.id, row.request.turnId))
        .limit(1);
      if (!turn || turn.sessionId !== sessionId) return "stale";
      if (
        (row.request.status === "pending" || row.request.status === "approved") &&
        new Date(row.request.expiresAt).getTime() <= Date.now()
      ) {
        await settleRequest(tx, id, "expired", openStatuses);
        return "expired";
      }
      if (turn.status !== "running" && ["pending", "approved"].includes(row.request.status)) {
        await settleRequest(tx, id, "cancelled", openStatuses);
        return "cancelled";
      }
      switch (row.request.status) {
        case "pending":
          return "pending";
        case "approved":
          return "approved";
        case "denied":
          return "denied";
        case "expired":
          return "expired";
        case "cancelled":
          return "cancelled";
        default:
          return "stale";
      }
    });
  }

  return {
    /** Scans only this attempt's trusted private context; no context text leaves this method. */
    async prepare(
      sessionId: string,
      input: { question: string; requiresPrivateDisclosure?: boolean },
    ) {
      const question = requestQuestionSchema.parse(input.question);
      const expectedHash = queryHash(question);
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 72))`);
        const context = await readResearchContext(tx, { sessionId });
        if (!context) return { status: "unavailable" as const };
        if (CONTEXT_LIMITS.retrievalBytes - context.retrievalBytes < MIN_RESEARCH_BUDGET_BYTES)
          return { status: "budget" as const };

        await expireRequestRows(tx, context.turnId);
        // Once this turn has a terminal decision, every later query needs a new approval.
        const [terminal] = await tx
          .select({ id: conversationResearchRequests.id })
          .from(conversationResearchRequests)
          .where(
            and(
              eq(conversationResearchRequests.turnId, context.turnId),
              inArray(conversationResearchRequests.status, terminalStatuses),
            ),
          )
          .limit(1);
        const inspection = inspectResearchQuestion({
          question,
          privateTexts: context.privateTexts,
          requiresPrivateDisclosure: input.requiresPrivateDisclosure,
          contextUncertain: context.contextUncertain,
        });
        const [openRequest] = await tx
          .select({ id: conversationResearchRequests.id })
          .from(conversationResearchRequests)
          .where(
            and(
              eq(conversationResearchRequests.turnId, context.turnId),
              // Any wording: while the owner is deciding, nothing leaves this turn unapproved.
              inArray(conversationResearchRequests.status, ["pending", "approved"]),
            ),
          )
          .limit(1);
        if (inspection.status === "generalized" && !terminal && !openRequest)
          return {
            status: "generalized" as const,
            outboundQuestion: inspection.outboundQuestion,
            queryHash: queryHash(inspection.outboundQuestion),
            contextHash: context.contextHash,
          };

        const [existing] = await tx
          .select()
          .from(conversationResearchRequests)
          .where(
            and(
              eq(conversationResearchRequests.turnId, context.turnId),
              eq(conversationResearchRequests.queryHash, expectedHash),
              inArray(conversationResearchRequests.status, ["pending", "approved"]),
            ),
          )
          .for("update");
        if (existing && existing.contextHash === context.contextHash && existing.proposedQuery) {
          return {
            status: "approval_required" as const,
            request: disclosureRequest(existing),
            contextHash: existing.contextHash,
          };
        }
        if (existing) await settleRequest(tx, existing.id, "stale", openStatuses);

        // Count every attempt, including denied, expired and autonomous ones, so a re-ask cannot loop.
        if (!(await reserveResearchAttempt(tx, context.turnId)))
          return { status: "limit" as const };

        const [request] = await tx
          .insert(conversationResearchRequests)
          .values({
            conversationId: context.conversationId,
            turnId: context.turnId,
            proposedQuery: question,
            queryHash: expectedHash,
            contextHash: context.contextHash,
            status: "pending",
            expiresAt: new Date(Date.now() + RESEARCH_REQUEST_TTL_MS).toISOString(),
          })
          .returning();
        return request
          ? {
              status: "approval_required" as const,
              request: disclosureRequest(request),
              contextHash: context.contextHash,
            }
          : { status: "unavailable" as const };
      });
    },

    /** Rechecks that a generalized query and its private context did not change before egress. */
    async claimGeneralized(
      sessionId: string,
      input: {
        question: string;
        outboundQuestion: string;
        queryHash: string;
        contextHash: string;
      },
    ) {
      const question = requestQuestionSchema.parse(input.question);
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 72))`);
        const context = await readResearchContext(tx, { sessionId });
        if (!context || context.contextHash !== input.contextHash) return "stale" as const;
        if (CONTEXT_LIMITS.retrievalBytes - context.retrievalBytes < MIN_RESEARCH_BUDGET_BYTES)
          return "budget" as const;
        await expireRequestRows(tx, context.turnId);
        const [terminal] = await tx
          .select({ id: conversationResearchRequests.id })
          .from(conversationResearchRequests)
          .where(
            and(
              eq(conversationResearchRequests.turnId, context.turnId),
              inArray(conversationResearchRequests.status, terminalStatuses),
            ),
          )
          .limit(1);
        if (terminal) return "stale" as const;
        const [openRequest] = await tx
          .select({ id: conversationResearchRequests.id })
          .from(conversationResearchRequests)
          .where(
            and(
              eq(conversationResearchRequests.turnId, context.turnId),
              inArray(conversationResearchRequests.status, ["pending", "approved"]),
            ),
          )
          .limit(1);
        if (openRequest) return "stale" as const;
        const inspection = inspectResearchQuestion({
          question,
          privateTexts: context.privateTexts,
          contextUncertain: context.contextUncertain,
        });
        return inspection.status === "generalized" &&
          inspection.outboundQuestion === input.outboundQuestion &&
          queryHash(inspection.outboundQuestion) === input.queryHash
          ? (await reserveResearchAttempt(tx, context.turnId))
            ? ("claimed" as const)
            : ("limit" as const)
          : ("stale" as const);
      });
    },

    /** Polls a durable user decision. Abort or Stop changes the request to cancelled. */
    async waitForDecision(
      sessionId: string,
      requestId: string,
      expectedHash: string,
      signal: AbortSignal,
    ): Promise<ResearchDecision> {
      try {
        while (true) {
          if (signal.aborted)
            throw new DOMException("Research approval wait cancelled.", "AbortError");
          const decision = await pollDecision(sessionId, requestId, expectedHash);
          if (decision !== "pending") return decision;
          await sleep(RESEARCH_REQUEST_POLL_MS, signal);
        }
      } catch (error) {
        if (signal.aborted) {
          await this.cancel(sessionId, requestId, expectedHash);
          return "cancelled";
        }
        throw error;
      }
    },

    /** Consumes a one-use approval after rechecking the account, turn, request and source context. */
    async claimApproved(
      sessionId: string,
      requestId: string,
      expectedHash: string,
      expectedContextHash: string,
    ): Promise<"claimed" | "expired" | "cancelled" | "stale" | "budget"> {
      const id = conversationIdSchema.parse(requestId);
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 72))`);
        const context = await readResearchContext(tx, { sessionId });
        const [request] = await tx
          .select({ request: conversationResearchRequests })
          .from(conversationResearchRequests)
          .innerJoin(
            conversationTurns,
            eq(conversationTurns.id, conversationResearchRequests.turnId),
          )
          .where(
            and(
              eq(conversationResearchRequests.id, id),
              eq(conversationResearchRequests.queryHash, expectedHash),
              eq(conversationTurns.sessionId, sessionId),
            ),
          )
          .for("update");
        if (!request) return "stale";
        const row = request.request;
        if (row.status === "expired") return "expired";
        if (
          (row.status === "pending" || row.status === "approved") &&
          new Date(row.expiresAt).getTime() <= Date.now()
        ) {
          await settleRequest(tx, id, "expired", openStatuses);
          return "expired";
        }
        if (row.status !== "approved") return row.status === "cancelled" ? "cancelled" : "stale";
        if (
          !context ||
          context.turnId !== row.turnId ||
          context.conversationId !== row.conversationId ||
          context.contextHash !== expectedContextHash ||
          row.contextHash !== expectedContextHash
        ) {
          await settleRequest(tx, id, "stale", openStatuses);
          return "stale";
        }
        if (CONTEXT_LIMITS.retrievalBytes - context.retrievalBytes < MIN_RESEARCH_BUDGET_BYTES) {
          await settleRequest(tx, id, "failed", openStatuses);
          return "budget";
        }
        await tx
          .update(conversationResearchRequests)
          .set({ status: "started", proposedQuery: null })
          .where(
            and(
              eq(conversationResearchRequests.id, id),
              eq(conversationResearchRequests.status, "approved"),
            ),
          );
        return "claimed";
      });
    },

    async cancel(sessionId: string, requestId: string, expectedHash: string) {
      const id = conversationIdSchema.parse(requestId);
      await db
        .update(conversationResearchRequests)
        .set({ status: "cancelled", proposedQuery: null, decidedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(conversationResearchRequests.id, id),
            eq(conversationResearchRequests.queryHash, expectedHash),
            inArray(conversationResearchRequests.status, ["pending", "approved", "started"]),
            inArray(
              conversationResearchRequests.turnId,
              db
                .select({ id: conversationTurns.id })
                .from(conversationTurns)
                .where(eq(conversationTurns.sessionId, sessionId)),
            ),
          ),
        );
    },

    async finish(
      sessionId: string,
      requestId: string,
      expectedHash: string,
      status: "completed" | "failed" | "cancelled",
    ) {
      const id = conversationIdSchema.parse(requestId);
      await db
        .update(conversationResearchRequests)
        .set({ status, proposedQuery: null, decidedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(conversationResearchRequests.id, id),
            eq(conversationResearchRequests.queryHash, expectedHash),
            eq(conversationResearchRequests.status, "started"),
            inArray(
              conversationResearchRequests.turnId,
              db
                .select({ id: conversationTurns.id })
                .from(conversationTurns)
                .where(eq(conversationTurns.sessionId, sessionId)),
            ),
          ),
        );
    },

    async recordResult(sessionId: string, output: unknown) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 72))`);
        const snapshots = await tx
          .select({ turn: conversationTurns, ownerId: conversations.ownerId })
          .from(conversationTurns)
          .innerJoin(conversations, eq(conversations.id, conversationTurns.conversationId))
          .where(
            and(
              eq(conversationTurns.sessionId, sessionId),
              eq(conversationTurns.status, "running"),
            ),
          )
          .limit(2);
        if (snapshots.length !== 1) return { status: "unavailable" as const };
        const snapshot = snapshots[0]!;
        const dependencies = sourceDependenciesSchema.safeParse(snapshot.turn.sourceDependencies);
        if (!dependencies.success) return { status: "unavailable" as const };
        if (!(await lockContextSources(tx, snapshot.ownerId, dependencies.data)))
          return { status: "unavailable" as const };
        const parent = await lockOwnedConversation(
          tx,
          snapshot.ownerId,
          snapshot.turn.conversationId,
        );
        if (!parent) return { status: "unavailable" as const };
        const [turn] = await tx
          .select()
          .from(conversationTurns)
          .where(
            and(
              eq(conversationTurns.id, snapshot.turn.id),
              eq(conversationTurns.status, "running"),
            ),
          );
        const [context] = await tx
          .select({ state: conversationContexts.state })
          .from(conversationContexts)
          .where(eq(conversationContexts.turnId, snapshot.turn.id));
        if (!turn || context?.state !== "ready") return { status: "unavailable" as const };
        const bytes = turn.retrievalBytes + byteSize(output);
        if (bytes > CONTEXT_LIMITS.retrievalBytes) return { status: "budget" as const };
        await tx
          .update(conversationTurns)
          .set({ retrievalBytes: bytes })
          .where(eq(conversationTurns.id, turn.id));
        return { status: "recorded" as const };
      });
    },

    async list(owner: string, conversationId: string) {
      const id = conversationIdSchema.parse(conversationId);
      return db.transaction(async (tx) => {
        const parent = await lockOwnedConversation(tx, owner, id);
        if (!parent) return undefined;
        const rows = await tx
          .select()
          .from(conversationResearchRequests)
          .where(
            and(
              eq(conversationResearchRequests.conversationId, id),
              inArray(conversationResearchRequests.status, ["pending", "approved"]),
            ),
          )
          .orderBy(asc(conversationResearchRequests.createdAt));
        for (const row of rows) {
          if (new Date(row.expiresAt).getTime() <= Date.now())
            await settleRequest(tx, row.id, "expired", openStatuses);
        }
        // Approval remains deniable until execution starts, so approved rows stay visible too.
        const open = rows
          .filter(
            (row) =>
              (row.status === "pending" || row.status === "approved") &&
              row.proposedQuery !== null &&
              new Date(row.expiresAt).getTime() > Date.now(),
          )
          .map(disclosureRequest);
        return researchDisclosureRequestsSchema.parse({ requests: open });
      });
    },

    /** Clears expired private payloads even if the owning runtime stopped polling. */
    async expire(limit = 100) {
      const size = z.number().int().min(1).max(500).parse(limit);
      const rows = await db
        .select({ id: conversationResearchRequests.id })
        .from(conversationResearchRequests)
        .where(
          and(
            inArray(conversationResearchRequests.status, ["pending", "approved"]),
            lt(conversationResearchRequests.expiresAt, sql`clock_timestamp()`),
          ),
        )
        .orderBy(asc(conversationResearchRequests.expiresAt))
        .limit(size);
      if (rows.length === 0) return 0;
      const expired = await db
        .update(conversationResearchRequests)
        .set({ status: "expired", proposedQuery: null, decidedAt: sql`clock_timestamp()` })
        .where(
          and(
            inArray(
              conversationResearchRequests.id,
              rows.map(({ id }) => id),
            ),
            inArray(conversationResearchRequests.status, openStatuses),
          ),
        )
        .returning({ id: conversationResearchRequests.id });
      return expired.length;
    },

    async decide(
      owner: string,
      conversationId: string,
      requestId: string,
      expectedHash: string,
      decision: "approve" | "deny",
    ): Promise<
      | { status: "approved" | "denied" }
      | { status: "not_found" | "mismatch" | "expired" | "stale" | "conflict" }
    > {
      const parentId = conversationIdSchema.parse(conversationId);
      const id = conversationIdSchema.parse(requestId);
      return db.transaction(async (tx) => {
        const [snapshot] = await tx
          .select({
            request: conversationResearchRequests,
            ownerId: conversations.ownerId,
            sourceDependencies: conversationTurns.sourceDependencies,
          })
          .from(conversationResearchRequests)
          .innerJoin(
            conversations,
            eq(conversations.id, conversationResearchRequests.conversationId),
          )
          .innerJoin(
            conversationTurns,
            eq(conversationTurns.id, conversationResearchRequests.turnId),
          )
          .where(
            and(
              eq(conversationResearchRequests.id, id),
              eq(conversationResearchRequests.conversationId, parentId),
              eq(conversations.ownerId, owner),
            ),
          );
        if (!snapshot) return { status: "not_found" as const };
        const dependencies = sourceDependenciesSchema.safeParse(snapshot.sourceDependencies);
        const sourcesAvailable =
          dependencies.success &&
          (await lockContextSources(tx, snapshot.ownerId, dependencies.data));
        const parent = await lockOwnedConversation(tx, owner, parentId);
        if (!parent) return { status: "not_found" as const };
        const [request] = await tx
          .select()
          .from(conversationResearchRequests)
          .where(
            and(
              eq(conversationResearchRequests.id, id),
              eq(conversationResearchRequests.conversationId, parentId),
            ),
          )
          .for("update");
        if (!request) return { status: "not_found" as const };
        if (request.queryHash !== expectedHash) return { status: "mismatch" as const };
        if (request.status === "expired") return { status: "expired" as const };
        if (
          (request.status === "pending" || request.status === "approved") &&
          new Date(request.expiresAt).getTime() <= Date.now()
        ) {
          await settleRequest(tx, id, "expired", openStatuses);
          return { status: "expired" as const };
        }
        if (request.status === "denied" && decision === "deny") return { status: "denied" };
        // Idempotent replay after a lost approve response, including once execution started.
        if (
          decision === "approve" &&
          (request.status === "started" || request.status === "completed")
        )
          return { status: "approved" as const };
        if (request.status !== "pending" && request.status !== "approved")
          return { status: "conflict" as const };

        // Denial remains available until a provider call starts, including after approval.
        if (decision === "deny") {
          await tx
            .update(conversationResearchRequests)
            .set({ status: "denied", proposedQuery: null, decidedAt: sql`clock_timestamp()` })
            .where(
              and(
                eq(conversationResearchRequests.id, id),
                inArray(conversationResearchRequests.status, openStatuses),
              ),
            );
          return { status: "denied" as const };
        }

        const context =
          sourcesAvailable && dependencies.success
            ? await readResearchContext(tx, {
                turnId: request.turnId,
                conversationId: parentId,
              })
            : undefined;
        if (!context || context.ownerId !== owner || context.contextHash !== request.contextHash) {
          await settleRequest(tx, id, "stale", openStatuses);
          return { status: "stale" as const };
        }
        if (request.status === "approved") return { status: "approved" as const };

        await tx
          .update(conversationResearchRequests)
          .set({
            status: "approved",
            proposedQuery: request.proposedQuery,
            decidedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(conversationResearchRequests.id, id),
              eq(conversationResearchRequests.status, "pending"),
            ),
          );
        return { status: "approved" as const };
      });
    },
  };
}
