CREATE TABLE "failed_organize_requests" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"text" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organize_start_requests" (
	"owner_id" text NOT NULL,
	"key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"run_id" uuid NOT NULL,
	CONSTRAINT "organize_start_requests_owner_id_key_pk" PRIMARY KEY("owner_id","key")
);
--> statement-breakpoint
ALTER TABLE "note_drafts" ALTER COLUMN "source_note_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "note_drafts" ALTER COLUMN "source_revision" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organize_runs" ALTER COLUMN "note_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organize_runs" ALTER COLUMN "source_revision" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "note_drafts" ADD COLUMN "generation" jsonb;--> statement-breakpoint
ALTER TABLE "note_drafts" ADD COLUMN "original" jsonb;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "generation" jsonb;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "original" jsonb;--> statement-breakpoint
ALTER TABLE "organize_runs" ADD COLUMN "original" jsonb;--> statement-breakpoint
ALTER TABLE "failed_organize_requests" ADD CONSTRAINT "failed_organize_requests_run_id_organize_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."organize_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "failed_organize_requests_owner_expiry_idx" ON "failed_organize_requests" USING btree ("owner_id","expires_at");--> statement-breakpoint
CREATE INDEX "failed_organize_requests_expiry_idx" ON "failed_organize_requests" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "note_drafts" ADD CONSTRAINT "note_drafts_source_pair" CHECK (("note_drafts"."source_note_id" IS NULL) = ("note_drafts"."source_revision" IS NULL));--> statement-breakpoint
ALTER TABLE "note_drafts" ADD CONSTRAINT "note_drafts_request_original" CHECK ("note_drafts"."source_note_id" IS NOT NULL OR ("note_drafts"."original" IS NOT NULL AND "note_drafts"."original"->>'kind' IS NOT DISTINCT FROM 'request'));--> statement-breakpoint
ALTER TABLE "organize_runs" ADD CONSTRAINT "organize_runs_original_active" CHECK ("organize_runs"."original" IS NULL OR ("organize_runs"."active" AND "organize_runs"."cleanup_target" IS NULL));--> statement-breakpoint
ALTER TABLE "organize_runs" ADD CONSTRAINT "organize_runs_source_pair" CHECK (("organize_runs"."note_id" IS NULL) = ("organize_runs"."source_revision" IS NULL));