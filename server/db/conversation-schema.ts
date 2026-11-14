import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnswerEvidenceSource } from "../../shared/evidence.ts";
import type { ContextMessage, ContextRecovery, SourceDependency } from "../conversation-context.ts";

export type ConversationTurnStatus =
  | "queued"
  | "running"
  | "completed"
  | "no-support"
  | "incomplete";

export type ConversationResearchRequestStatus =
  | "pending"
  | "approved"
  | "started"
  | "completed"
  | "denied"
  | "expired"
  | "cancelled"
  | "stale"
  | "failed";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    queuePaused: boolean("queue_paused").notNull().default(false),
    nextSequence: integer("next_sequence").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("conversations_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
    check("conversations_sequence_positive", sql`${table.nextSequence} > 0`),
  ],
);

/** Content-free receipts survive conversation deletion until account deletion. */
export const conversationCreateRequests = pgTable(
  "conversation_create_requests",
  {
    ownerId: text("owner_id").notNull(),
    key: uuid("key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    conversationId: uuid("conversation_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.key] })],
);

export const conversationTurns = pgTable(
  "conversation_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").$type<ConversationTurnStatus>().notNull().default("queued"),
    reason: text("reason").$type<"failed" | "cancelled">(),
    runningText: text("running_text"),
    checkpointVersion: integer("checkpoint_version").notNull().default(0),
    retryOfId: uuid("retry_of_id"),
    allocationOperationId: uuid("allocation_operation_id"),
    runtimeUrl: text("runtime_url"),
    sessionId: text("session_id"),
    sourceDependencies: jsonb("source_dependencies")
      .$type<SourceDependency[]>()
      .notNull()
      .default([]),
    provenanceComplete: boolean("provenance_complete").notNull().default(false),
    retrievalBytes: integer("retrieval_bytes").notNull().default(0),
    /** Durable count of autonomous and approval-gated research attempts in this turn. */
    researchAttempts: integer("research_attempts").notNull().default(0),
    contextRecovery: text("context_recovery").$type<ContextRecovery>(),
    /** Runtime receipt for the opening input. Private, like the session identity. */
    deliveryId: text("delivery_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("conversation_turns_parent_id_unique").on(table.conversationId, table.id),
    uniqueIndex("conversation_turns_operation_idx").on(table.conversationId, table.operationId),
    uniqueIndex("conversation_turns_running_idx")
      .on(table.conversationId)
      .where(sql`${table.status} = 'running'`),
    // Conversation reads resolve only the latest attempt's recovery state.
    index("conversation_turns_latest_idx").on(table.conversationId, table.createdAt, table.id),
    uniqueIndex("conversation_turns_allocation_idx").on(table.allocationOperationId),
    foreignKey({
      name: "conversation_turns_retry_parent_fk",
      columns: [table.conversationId, table.retryOfId],
      foreignColumns: [table.conversationId, table.id],
    }),
    check(
      "conversation_turns_status_valid",
      sql`${table.status} IN ('queued', 'running', 'completed', 'no-support', 'incomplete')`,
    ),
    check(
      "conversation_turns_reason_valid",
      sql`(${table.status} = 'incomplete' AND ${table.reason} IN ('failed', 'cancelled') AND ${table.reason} IS NOT NULL) OR (${table.status} <> 'incomplete' AND ${table.reason} IS NULL)`,
    ),
    check(
      "conversation_turns_checkpoint_valid",
      sql`${table.checkpointVersion} >= 0 AND (${table.status} = 'running' OR ${table.runningText} IS NULL)`,
    ),
    check("conversation_turns_retrieval_bound", sql`${table.retrievalBytes} BETWEEN 0 AND 48000`),
    check(
      "conversation_turns_research_attempts_valid",
      sql`${table.researchAttempts} BETWEEN 0 AND 3`,
    ),
    check(
      "conversation_turns_recovery_valid",
      sql`${table.contextRecovery} IS NULL OR ${table.contextRecovery} IN ('history_unavailable', 'context_budget', 'summary_failed', 'source_changed', 'runtime_expired')`,
    ),
    check(
      "conversation_turns_retry_distinct",
      sql`${table.retryOfId} IS NULL OR ${table.retryOfId} <> ${table.id}`,
    ),
    check(
      "conversation_turns_runtime_complete",
      sql`(${table.allocationOperationId} IS NULL AND ${table.runtimeUrl} IS NULL AND ${table.sessionId} IS NULL) OR (${table.allocationOperationId} IS NOT NULL AND ${table.runtimeUrl} IS NOT NULL)`,
    ),
  ],
);

/** Accepted inputs and finalized outputs are immutable; checkpoints belong to the turn. */
export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    sequence: integer("sequence").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    deliveryPolicy: text("delivery_policy").$type<"queue" | "steer">(),
    text: text("text").notNull(),
    turnId: uuid("turn_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("conversation_messages_parent_id_unique").on(table.conversationId, table.id),
    uniqueIndex("conversation_messages_sequence_idx").on(table.conversationId, table.sequence),
    uniqueIndex("conversation_messages_operation_idx").on(table.conversationId, table.operationId),
    uniqueIndex("conversation_messages_turn_idx").on(table.turnId),
    foreignKey({
      name: "conversation_messages_turn_parent_fk",
      columns: [table.conversationId, table.turnId],
      foreignColumns: [conversationTurns.conversationId, conversationTurns.id],
    }).onDelete("cascade"),
    check("conversation_messages_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "conversation_messages_role_valid",
      sql`(${table.role} = 'user' AND ${table.turnId} IS NULL) OR (${table.role} = 'assistant' AND ${table.turnId} IS NOT NULL)`,
    ),
    check(
      "conversation_messages_policy_valid",
      sql`(${table.role} = 'user' AND ${table.deliveryPolicy} IS NOT NULL AND ${table.deliveryPolicy} IN ('queue', 'steer')) OR (${table.role} = 'assistant' AND ${table.deliveryPolicy} IS NULL)`,
    ),
  ],
);

export const conversationTurnInputs = pgTable(
  "conversation_turn_inputs",
  {
    conversationId: uuid("conversation_id").notNull(),
    turnId: uuid("turn_id").notNull(),
    messageId: uuid("message_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    /** True when the input joined an attempt that was already running. */
    steer: boolean("steer").notNull().default(false),
    /** Runtime receipt once a steering input reached the bound session. */
    deliveryId: text("delivery_id"),
  },
  (table) => [
    primaryKey({ columns: [table.turnId, table.messageId] }),
    uniqueIndex("conversation_turn_inputs_order_idx").on(table.turnId, table.ordinal),
    foreignKey({
      name: "conversation_turn_inputs_turn_parent_fk",
      columns: [table.conversationId, table.turnId],
      foreignColumns: [conversationTurns.conversationId, conversationTurns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_turn_inputs_message_parent_fk",
      columns: [table.conversationId, table.messageId],
      foreignColumns: [conversationMessages.conversationId, conversationMessages.id],
    }).onDelete("cascade"),
    check("conversation_turn_inputs_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check(
      "conversation_turn_inputs_delivery_steer",
      sql`${table.steer} OR ${table.deliveryId} IS NULL`,
    ),
  ],
);

/** Private disclosure payloads are kept only while a decision can still authorize this turn. */
export const conversationResearchRequests = pgTable(
  "conversation_research_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull(),
    turnId: uuid("turn_id").notNull(),
    proposedQuery: text("proposed_query"),
    queryHash: text("query_hash").notNull(),
    contextHash: text("context_hash").notNull(),
    status: text("status").$type<ConversationResearchRequestStatus>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "conversation_research_requests_turn_parent_fk",
      columns: [table.conversationId, table.turnId],
      foreignColumns: [conversationTurns.conversationId, conversationTurns.id],
    }).onDelete("cascade"),
    index("conversation_research_requests_turn_idx").on(
      table.conversationId,
      table.turnId,
      table.createdAt,
    ),
    uniqueIndex("conversation_research_requests_active_query_idx")
      .on(table.turnId, table.queryHash)
      .where(sql`${table.status} IN ('pending', 'approved')`),
    check(
      "conversation_research_requests_status_valid",
      sql`${table.status} IN ('pending', 'approved', 'started', 'completed', 'denied', 'expired', 'cancelled', 'stale', 'failed')`,
    ),
    check(
      "conversation_research_requests_payload_valid",
      sql`(${table.status} IN ('pending', 'approved') AND ${table.proposedQuery} IS NOT NULL AND length(${table.proposedQuery}) BETWEEN 1 AND 500) OR (${table.status} NOT IN ('pending', 'approved') AND ${table.proposedQuery} IS NULL)`,
    ),
    check(
      "conversation_research_requests_hash_valid",
      sql`${table.queryHash} ~ '^[0-9a-f]{64}$' AND ${table.contextHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/** No note foreign key: deleting a source removes only its own excerpt, not the delivered answer. */
export const conversationCitations = pgTable(
  "conversation_citations",
  {
    conversationId: uuid("conversation_id").notNull(),
    messageId: uuid("message_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    noteId: uuid("note_id"),
    source: jsonb("source").$type<AnswerEvidenceSource>().notNull(),
    excerpt: text("excerpt"),
    deleted: boolean("deleted").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.ordinal] }),
    index("conversation_citations_note_idx").on(table.noteId),
    foreignKey({
      name: "conversation_citations_message_parent_fk",
      columns: [table.conversationId, table.messageId],
      foreignColumns: [conversationMessages.conversationId, conversationMessages.id],
    }).onDelete("cascade"),
    check("conversation_citations_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check(
      "conversation_citations_source_identity",
      sql`(${table.source}->>'kind' IS NOT NULL) AND ((${table.source}->>'kind' = 'web' AND ${table.noteId} IS NULL AND NOT jsonb_exists(${table.source}, 'noteId')) OR (${table.source}->>'kind' IN ('block', 'markdown') AND ${table.noteId} IS NOT NULL AND ${table.source}->>'noteId' IS NOT NULL AND ${table.source}->>'noteId' = ${table.noteId}::text))`,
    ),
    check(
      "conversation_citations_redaction_valid",
      sql`(${table.deleted} AND ${table.excerpt} IS NULL) OR (NOT ${table.deleted} AND ${table.excerpt} IS NOT NULL AND length(${table.excerpt}) > 0)`,
    ),
  ],
);

/** Persist even when allocation has not returned a session ID. Never expire an unknown outcome. */
export const conversationCleanupIntents = pgTable(
  "conversation_cleanup_intents",
  {
    allocationOperationId: uuid("allocation_operation_id").primaryKey(),
    purpose: text("purpose").$type<"answer" | "summary">().notNull().default("answer"),
    ownerId: text("owner_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    runtimeUrl: text("runtime_url").notNull(),
    sessionId: text("session_id"),
    attempts: integer("attempts").notNull().default(0),
    retryAt: timestamp("retry_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    lastFailureCode: text("last_failure_code").$type<"allocation_unknown" | "cleanup_failed">(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("conversation_cleanup_retry_idx").on(table.retryAt),
    check("conversation_cleanup_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check("conversation_cleanup_purpose_valid", sql`${table.purpose} IN ('answer', 'summary')`),
    check(
      "conversation_cleanup_failure_code_valid",
      sql`${table.lastFailureCode} IS NULL OR ${table.lastFailureCode} IN ('allocation_unknown', 'cleanup_failed')`,
    ),
  ],
);

/** One replaceable checkpoint, independent of the immutable UI message history. */
export const conversationSummaries = pgTable(
  "conversation_summaries",
  {
    conversationId: uuid("conversation_id")
      .primaryKey()
      .references(() => conversations.id, { onDelete: "cascade" }),
    throughSequence: integer("through_sequence").notNull(),
    text: text("text").notNull(),
    sources: jsonb("sources").$type<SourceDependency[]>().notNull(),
    deferredInputIds: jsonb("deferred_input_ids").$type<string[]>().notNull().default([]),
  },
  (table) => [
    index("conversation_summaries_sources_idx").using("gin", table.sources),
    check(
      "conversation_summaries_bounds",
      sql`${table.throughSequence} > 0 AND octet_length(${table.text}) BETWEEN 1 AND 4000`,
    ),
  ],
);

/** A fixed context snapshot and durable compaction operation for one answer attempt. */
export const conversationContexts = pgTable(
  "conversation_contexts",
  {
    turnId: uuid("turn_id").primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    operationId: uuid("operation_id").notNull().unique(),
    state: text("state").$type<"summarizing" | "ready" | "recovery">().notNull(),
    throughSequence: integer("through_sequence").notNull(),
    deferredInputIds: jsonb("deferred_input_ids").$type<string[]>().notNull().default([]),
    recent: jsonb("recent").$type<ContextMessage[]>().notNull(),
    summary: text("summary"),
    summaryInput: text("summary_input"),
    sources: jsonb("sources").$type<SourceDependency[]>().notNull(),
    runtimeUrl: text("runtime_url").notNull(),
    sessionId: text("session_id"),
    deliveryId: text("delivery_id"),
  },
  (table) => [
    index("conversation_contexts_sources_idx").using("gin", table.sources),
    foreignKey({
      columns: [table.conversationId, table.turnId],
      foreignColumns: [conversationTurns.conversationId, conversationTurns.id],
    }).onDelete("cascade"),
    check(
      "conversation_contexts_state_valid",
      sql`${table.state} IN ('summarizing', 'ready', 'recovery')`,
    ),
    check(
      "conversation_contexts_content_valid",
      sql`(${table.state} = 'summarizing' AND ${table.summaryInput} IS NOT NULL) OR (${table.state} <> 'summarizing' AND ${table.summaryInput} IS NULL)`,
    ),
  ],
);

/** Sliding window of accepted message sends per verified owner, shared by all API processes. */
export const conversationAdmissions = pgTable(
  "conversation_admissions",
  {
    ownerId: text("owner_id").primaryKey(),
    admittedAt: timestamp("admitted_at", { withTimezone: true, mode: "string" })
      .array()
      .notNull()
      .default(sql`ARRAY[]::timestamptz[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("conversation_admissions_expiry_idx").on(table.expiresAt),
    check("conversation_admissions_bounded", sql`cardinality(${table.admittedAt}) <= 20`),
  ],
);
