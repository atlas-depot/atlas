import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { OrganizeRunState } from "../organize-runs.ts";
import type { OrganizeUsage } from "../organize-note.ts";
import type { RunTerminalState } from "./organize-runs.ts";
import type { NoteOrigin } from "../../shared/organize.ts";
import type { NoteContent } from "../../shared/document.ts";
import type { NotePassageSource } from "../../shared/passages.ts";
import type { IndexFailureCode } from "../../shared/index-jobs.ts";
import { EMBEDDING_DIMENSIONS } from "../../shared/embedding.ts";

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Verified WorkOS identity; never taken from a note payload. */
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    origin: jsonb("origin").$type<NoteOrigin>(),
    content: jsonb("content").$type<NoteContent>().notNull(),
    /** Supplied by the client on creation and immutable in note operations. */
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    /** Initially createdAt; successful edits supply the server timestamp. */
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    /** Internal concurrency counter, not part of the public Note JSON. */
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    index("notes_owner_id_idx").on(table.ownerId),
    check("notes_revision_positive", sql`${table.revision} > 0`),
  ],
);

/** Pending indexing work contains identity/revision only, never a content snapshot. */
export const noteIndexIntents = pgTable(
  "note_index_intents",
  {
    noteId: uuid("note_id")
      .primaryKey()
      .references(() => notes.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    fingerprint: text("fingerprint").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    claimToken: uuid("claim_token"),
    runId: text("run_id"),
    runtimeUrl: text("runtime_url"),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "string" }),
    retryAt: timestamp("retry_at", { withTimezone: true, mode: "string" }).defaultNow(),
    failureCode: text("failure_code").$type<IndexFailureCode>(),
    attempts: integer("attempts").notNull().default(0),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("note_index_intents_revision_positive", sql`${table.revision} > 0`),
    check("note_index_intents_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check(
      "note_index_intents_claim_complete",
      sql`(${table.claimToken} IS NULL AND ${table.runId} IS NULL AND ${table.runtimeUrl} IS NULL AND ${table.claimedAt} IS NULL) OR (${table.claimToken} IS NOT NULL AND ${table.runtimeUrl} IS NOT NULL AND ${table.claimedAt} IS NOT NULL)`,
    ),
    index("note_index_intents_checked_idx").on(table.lastCheckedAt, table.noteId),
  ],
);

/** Only the current publication is retained; an empty publication has no passage rows. */
export const noteIndexes = pgTable(
  "note_indexes",
  {
    noteId: uuid("note_id")
      .primaryKey()
      .references(() => notes.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    fingerprint: text("fingerprint").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("note_indexes_revision_positive", sql`${table.revision} > 0`)],
);

export const notePassages = pgTable(
  "note_passages",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => noteIndexes.noteId, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    source: jsonb("source").$type<NotePassageSource>().notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.noteId, table.ordinal] }),
    check("note_passages_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
  ],
);

/** Content-free creation receipts survive note deletion to prevent duplicate retries. */
export const noteCreateRequests = pgTable(
  "note_create_requests",
  {
    ownerId: text("owner_id").notNull(),
    key: uuid("key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    // No cascading relation: deletion must not make a creation key reusable.
    noteId: uuid("note_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.key] })],
);

export const organizeRuns = pgTable(
  "organize_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    // Keep the cleanup address after source deletion; cascading would orphan eve history.
    noteId: uuid("note_id").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    runtimeUrl: text("runtime_url").notNull(),
    input: jsonb("input").$type<{ title: string; content: string }>(),
    runtime: jsonb("runtime").$type<{ sessionId: string; deliveryId: string | null }>(),
    state: jsonb("state").$type<OrganizeRunState>().notNull(),
    usage: jsonb("usage").$type<OrganizeUsage>(),
    active: boolean("active").notNull(),
    cleanupTarget: jsonb("cleanup_target").$type<RunTerminalState>(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("organize_runs_active_note_idx")
      .on(table.ownerId, table.noteId)
      .where(sql`${table.active}`),
    index("organize_runs_expiry_idx").on(table.expiresAt),
    index("organize_runs_pending_idx")
      .on(table.updatedAt)
      .where(sql`${table.active}`),
    check("organize_runs_revision_positive", sql`${table.sourceRevision} > 0`),
    check(
      "organize_runs_cleanup_target",
      sql`${table.cleanupTarget} IS NULL OR ${table.cleanupTarget}->>'status' IN ('expired', 'cancelled', 'not_found', 'failed')`,
    ),
    check(
      "organize_runs_terminal_content",
      sql`${table.active} OR (${table.input} IS NULL AND ${table.runtime} IS NULL AND ${table.cleanupTarget} IS NULL AND ${table.state}->>'status' NOT IN ('running', 'draft', 'cleaning'))`,
    ),
  ],
);

/** Temporary user edits. The source relationship intentionally survives source deletion. */
export const noteDrafts = pgTable(
  "note_drafts",
  {
    id: uuid("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    sourceNoteId: uuid("source_note_id").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").$type<NoteContent>().notNull(),
    sources: jsonb("sources").$type<NoteOrigin["sources"]>().notNull(),
    revision: integer("revision").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("note_drafts_source_idx").on(table.ownerId, table.sourceNoteId),
    index("note_drafts_expiry_idx").on(table.expiresAt),
    check(
      "note_drafts_revision_positive",
      sql`${table.revision} > 0 AND ${table.sourceRevision} > 0`,
    ),
  ],
);

/** A content-free receipt makes every Save of one draft converge on one permanent note. */
export const draftSaveRequests = pgTable(
  "draft_save_requests",
  {
    ownerId: text("owner_id").notNull(),
    draftId: uuid("draft_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    noteId: uuid("note_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.draftId] })],
);
