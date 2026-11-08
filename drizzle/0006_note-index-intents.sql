CREATE TABLE "note_index_intents" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_index_intents_revision_positive" CHECK ("note_index_intents"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "note_index_intents" ADD CONSTRAINT "note_index_intents_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "note_index_intents" ("note_id", "revision")
SELECT "id", "revision" FROM "notes";
