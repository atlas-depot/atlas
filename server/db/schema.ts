import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
