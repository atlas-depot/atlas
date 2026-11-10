import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { ConversationTransaction } from "./conversation-publication.ts";
import type { openDatabase } from "./connection.ts";
import { conversationAdmissions } from "./schema.ts";

type Database = ReturnType<typeof openDatabase>["db"];
const WINDOW_MS = 60_000;
const REQUEST_LIMIT = 20;

export async function expireConversationAdmissions(db: Database) {
  // Commit cleanup before locking the requested owner so concurrent owners cannot deadlock.
  // Bounded opportunistic cleanup does not wait on owners currently admitting a request.
  await db.execute(sql`
      WITH expired AS (
        SELECT owner_id FROM ${conversationAdmissions}
        WHERE expires_at <= clock_timestamp()
        ORDER BY expires_at, owner_id LIMIT 100 FOR UPDATE SKIP LOCKED
      )
      DELETE FROM ${conversationAdmissions} AS admissions
      USING expired WHERE admissions.owner_id = expired.owner_id
  `);
}

/** Reserve one send in the transaction that inserts its new, owned message. */
export async function admitConversationInput(tx: ConversationTransaction, owner: string) {
  // Upsert acquires the same row lock for first and concurrent subsequent requests.
  const [row] = await tx
    .insert(conversationAdmissions)
    .values({ ownerId: owner })
    .onConflictDoUpdate({ target: conversationAdmissions.ownerId, set: { ownerId: owner } })
    .returning();
  // Read the database clock after obtaining the lock, not when the transaction began.
  const clock = await tx.execute<{ now: string }>(
    sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::text AS now`,
  );
  const now = z.number().int().safe().parse(Number(clock.rows[0]?.now));
  const recent = row.admittedAt
    .map((value) => z.number().finite().parse(Date.parse(value)))
    .filter((value) => value > now - WINDOW_MS);
  if (recent.length >= REQUEST_LIMIT) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((Math.min(...recent) + WINDOW_MS - now) / 1000)),
    };
  }
  const admitted = [...recent, now];
  await tx
    .update(conversationAdmissions)
    .set({
      admittedAt: admitted.map((value) => new Date(value).toISOString()),
      expiresAt: new Date(Math.max(...admitted) + WINDOW_MS).toISOString(),
    })
    .where(eq(conversationAdmissions.ownerId, owner));
  return { allowed: true as const };
}
