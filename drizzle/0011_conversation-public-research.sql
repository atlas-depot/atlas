CREATE TABLE "conversation_research_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"proposed_query" text,
	"query_hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_research_requests_status_valid" CHECK ("conversation_research_requests"."status" IN ('pending', 'approved', 'started', 'completed', 'denied', 'expired', 'cancelled', 'stale', 'failed')),
	CONSTRAINT "conversation_research_requests_payload_valid" CHECK (("conversation_research_requests"."status" IN ('pending', 'approved') AND "conversation_research_requests"."proposed_query" IS NOT NULL AND length("conversation_research_requests"."proposed_query") BETWEEN 1 AND 500) OR ("conversation_research_requests"."status" NOT IN ('pending', 'approved') AND "conversation_research_requests"."proposed_query" IS NULL)),
	CONSTRAINT "conversation_research_requests_hash_valid" CHECK ("conversation_research_requests"."query_hash" ~ '^[0-9a-f]{64}$' AND "conversation_research_requests"."context_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "conversation_citations" ALTER COLUMN "note_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "research_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_research_attempts_valid" CHECK ("conversation_turns"."research_attempts" BETWEEN 0 AND 3);--> statement-breakpoint
ALTER TABLE "conversation_research_requests" ADD CONSTRAINT "conversation_research_requests_turn_parent_fk" FOREIGN KEY ("conversation_id","turn_id") REFERENCES "public"."conversation_turns"("conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_research_requests_turn_idx" ON "conversation_research_requests" USING btree ("conversation_id","turn_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_research_requests_active_query_idx" ON "conversation_research_requests" USING btree ("turn_id","query_hash") WHERE "conversation_research_requests"."status" IN ('pending', 'approved');--> statement-breakpoint
ALTER TABLE "conversation_citations" ADD CONSTRAINT "conversation_citations_source_identity" CHECK (("conversation_citations"."source"->>'kind' IS NOT NULL) AND (("conversation_citations"."source"->>'kind' = 'web' AND "conversation_citations"."note_id" IS NULL AND NOT jsonb_exists("conversation_citations"."source", 'noteId')) OR ("conversation_citations"."source"->>'kind' IN ('block', 'markdown') AND "conversation_citations"."note_id" IS NOT NULL AND "conversation_citations"."source"->>'noteId' = "conversation_citations"."note_id"::text)));
