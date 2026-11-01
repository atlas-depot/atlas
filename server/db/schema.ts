import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { OrganizeRunState } from "../organize-runs.ts";
import type { RunTerminalState } from "./organize-runs.ts";

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Verified WorkOS identity; never taken from a note payload. */
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
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
