CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "notes_revision_positive" CHECK ("notes"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX "notes_owner_id_idx" ON "notes" USING btree ("owner_id");