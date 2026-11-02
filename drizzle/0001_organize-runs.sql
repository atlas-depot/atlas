CREATE TABLE "organize_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"note_id" uuid NOT NULL,
	"source_revision" integer NOT NULL,
	"runtime_url" text NOT NULL,
	"input" jsonb,
	"runtime" jsonb,
	"state" jsonb NOT NULL,
	"active" boolean NOT NULL,
	"cleanup_target" jsonb,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organize_runs_revision_positive" CHECK ("organize_runs"."source_revision" > 0),
	CONSTRAINT "organize_runs_cleanup_target" CHECK ("organize_runs"."cleanup_target" IS NULL OR "organize_runs"."cleanup_target"->>'status' IN ('expired', 'cancelled', 'not_found', 'failed')),
	CONSTRAINT "organize_runs_terminal_content" CHECK ("organize_runs"."active" OR ("organize_runs"."input" IS NULL AND "organize_runs"."runtime" IS NULL AND "organize_runs"."cleanup_target" IS NULL AND "organize_runs"."state"->>'status' NOT IN ('running', 'draft', 'cleaning')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organize_runs_active_note_idx" ON "organize_runs" USING btree ("owner_id","note_id") WHERE "organize_runs"."active";--> statement-breakpoint
CREATE INDEX "organize_runs_expiry_idx" ON "organize_runs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "organize_runs_pending_idx" ON "organize_runs" USING btree ("updated_at") WHERE "organize_runs"."active";