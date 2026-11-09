CREATE EXTENSION IF NOT EXISTS vector;
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
ALTER TABLE "note_indexes" ADD CONSTRAINT "note_indexes_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_passages" ADD CONSTRAINT "note_passages_note_id_note_indexes_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note_indexes"("note_id") ON DELETE cascade ON UPDATE no action;
