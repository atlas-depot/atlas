CREATE TABLE "draft_save_requests" (
	"owner_id" text NOT NULL,
	"draft_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"note_id" uuid NOT NULL,
	CONSTRAINT "draft_save_requests_owner_id_draft_id_pk" PRIMARY KEY("owner_id","draft_id")
);
--> statement-breakpoint
CREATE TABLE "note_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"source_note_id" uuid NOT NULL,
	"source_revision" integer NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "note_drafts_revision_positive" CHECK ("note_drafts"."revision" > 0 AND "note_drafts"."source_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "origin" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "note_drafts_source_idx" ON "note_drafts" USING btree ("owner_id","source_note_id");--> statement-breakpoint
CREATE INDEX "note_drafts_expiry_idx" ON "note_drafts" USING btree ("expires_at");