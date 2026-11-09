CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "note_index_intents" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"run_id" text,
	"runtime_url" text,
	"claimed_at" timestamp with time zone,
	"retry_at" timestamp with time zone DEFAULT now(),
	"failure_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_index_intents_revision_positive" CHECK ("note_index_intents"."revision" > 0),
	CONSTRAINT "note_index_intents_attempts_nonnegative" CHECK ("note_index_intents"."attempts" >= 0),
	CONSTRAINT "note_index_intents_claim_complete" CHECK (("note_index_intents"."claim_token" IS NULL AND "note_index_intents"."run_id" IS NULL AND "note_index_intents"."runtime_url" IS NULL AND "note_index_intents"."claimed_at" IS NULL) OR ("note_index_intents"."claim_token" IS NOT NULL AND "note_index_intents"."runtime_url" IS NOT NULL AND "note_index_intents"."claimed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "note_indexes" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_indexes_revision_positive" CHECK ("note_indexes"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "note_passages" (
	"note_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"source" jsonb NOT NULL,
	"embedding" vector(1536) NOT NULL,
	CONSTRAINT "note_passages_note_id_ordinal_pk" PRIMARY KEY("note_id","ordinal"),
	CONSTRAINT "note_passages_ordinal_nonnegative" CHECK ("note_passages"."ordinal" >= 0)
);
--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD CONSTRAINT "note_index_intents_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_indexes" ADD CONSTRAINT "note_indexes_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_passages" ADD CONSTRAINT "note_passages_note_id_note_indexes_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note_indexes"("note_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_index_intents_checked_idx" ON "note_index_intents" USING btree ("last_checked_at","note_id");
--> statement-breakpoint
INSERT INTO "note_index_intents" ("note_id", "revision", "fingerprint")
SELECT "id", "revision", '{"version":1,"model":"qwen/qwen3-embedding-8b","dimensions":1536,"projection":2,"document":"plain-passage-text","query":"Instruct: Given a question, retrieve personal notes that contain evidence to answer it.\nQuery: <query>"}' FROM "notes";
