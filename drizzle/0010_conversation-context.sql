CREATE TABLE "conversation_contexts" (
	"turn_id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"state" text NOT NULL,
	"through_sequence" integer NOT NULL,
	"deferred_input_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recent" jsonb NOT NULL,
	"summary" text,
	"summary_input" text,
	"sources" jsonb NOT NULL,
	"runtime_url" text NOT NULL,
	"session_id" text,
	"delivery_id" text,
	CONSTRAINT "conversation_contexts_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "conversation_contexts_state_valid" CHECK ("conversation_contexts"."state" IN ('summarizing', 'ready', 'recovery')),
	CONSTRAINT "conversation_contexts_content_valid" CHECK (("conversation_contexts"."state" = 'summarizing' AND "conversation_contexts"."summary_input" IS NOT NULL) OR ("conversation_contexts"."state" <> 'summarizing' AND "conversation_contexts"."summary_input" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "conversation_summaries" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"through_sequence" integer NOT NULL,
	"text" text NOT NULL,
	"sources" jsonb NOT NULL,
	"deferred_input_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "conversation_summaries_bounds" CHECK ("conversation_summaries"."through_sequence" > 0 AND octet_length("conversation_summaries"."text") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "conversation_cleanup_intents" ADD COLUMN "purpose" text DEFAULT 'answer' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "source_dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "provenance_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "retrieval_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "context_recovery" text;--> statement-breakpoint
ALTER TABLE "conversation_contexts" ADD CONSTRAINT "conversation_contexts_conversation_id_turn_id_conversation_turns_conversation_id_id_fk" FOREIGN KEY ("conversation_id","turn_id") REFERENCES "public"."conversation_turns"("conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_contexts_sources_idx" ON "conversation_contexts" USING gin ("sources");--> statement-breakpoint
CREATE INDEX "conversation_summaries_sources_idx" ON "conversation_summaries" USING gin ("sources");--> statement-breakpoint
ALTER TABLE "conversation_cleanup_intents" ADD CONSTRAINT "conversation_cleanup_purpose_valid" CHECK ("conversation_cleanup_intents"."purpose" IN ('answer', 'summary'));--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_retrieval_bound" CHECK ("conversation_turns"."retrieval_bytes" BETWEEN 0 AND 48000);--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_recovery_valid" CHECK ("conversation_turns"."context_recovery" IS NULL OR "conversation_turns"."context_recovery" IN ('history_unavailable', 'context_budget', 'summary_failed', 'source_changed', 'runtime_expired'));