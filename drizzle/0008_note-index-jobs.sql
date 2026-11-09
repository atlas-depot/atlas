ALTER TABLE "note_index_intents" ADD COLUMN "fingerprint" text;--> statement-breakpoint
UPDATE "note_index_intents" SET "fingerprint" = '{"version":1,"model":"qwen/qwen3-embedding-8b","dimensions":1536,"projection":2,"document":"plain-passage-text","query":"Instruct: Given a question, retrieve personal notes that contain evidence to answer it.\nQuery: <query>"}';--> statement-breakpoint
ALTER TABLE "note_index_intents" ALTER COLUMN "fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD COLUMN "last_checked_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "note_index_intents" SET "last_checked_at" = "requested_at";--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD COLUMN "runtime_url" text;--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD COLUMN "retry_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "note_index_intents_checked_idx" ON "note_index_intents" USING btree ("last_checked_at","note_id");--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD CONSTRAINT "note_index_intents_attempts_nonnegative" CHECK ("note_index_intents"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD CONSTRAINT "note_index_intents_claim_complete" CHECK (("note_index_intents"."claim_token" IS NULL AND "note_index_intents"."run_id" IS NULL AND "note_index_intents"."runtime_url" IS NULL AND "note_index_intents"."claimed_at" IS NULL) OR ("note_index_intents"."claim_token" IS NOT NULL AND "note_index_intents"."runtime_url" IS NOT NULL AND "note_index_intents"."claimed_at" IS NOT NULL));