CREATE TABLE "conversation_citations" (
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"note_id" uuid NOT NULL,
	"source" jsonb NOT NULL,
	"excerpt" text,
	"deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conversation_citations_message_id_ordinal_pk" PRIMARY KEY("message_id","ordinal"),
	CONSTRAINT "conversation_citations_ordinal_nonnegative" CHECK ("conversation_citations"."ordinal" >= 0),
	CONSTRAINT "conversation_citations_redaction_valid" CHECK (("conversation_citations"."deleted" AND "conversation_citations"."excerpt" IS NULL) OR (NOT "conversation_citations"."deleted" AND "conversation_citations"."excerpt" IS NOT NULL AND length("conversation_citations"."excerpt") > 0))
);
--> statement-breakpoint
CREATE TABLE "conversation_cleanup_intents" (
	"allocation_operation_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"runtime_url" text NOT NULL,
	"session_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_cleanup_attempts_nonnegative" CHECK ("conversation_cleanup_intents"."attempts" >= 0),
	CONSTRAINT "conversation_cleanup_failure_code_valid" CHECK ("conversation_cleanup_intents"."last_failure_code" IS NULL OR "conversation_cleanup_intents"."last_failure_code" IN ('allocation_unknown', 'cleanup_failed'))
);
--> statement-breakpoint
CREATE TABLE "conversation_create_requests" (
	"owner_id" text NOT NULL,
	"key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	CONSTRAINT "conversation_create_requests_owner_id_key_pk" PRIMARY KEY("owner_id","key")
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"sequence" integer NOT NULL,
	"role" text NOT NULL,
	"delivery_policy" text,
	"text" text NOT NULL,
	"turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_parent_id_unique" UNIQUE("conversation_id","id"),
	CONSTRAINT "conversation_messages_sequence_positive" CHECK ("conversation_messages"."sequence" > 0),
	CONSTRAINT "conversation_messages_role_valid" CHECK (("conversation_messages"."role" = 'user' AND "conversation_messages"."turn_id" IS NULL) OR ("conversation_messages"."role" = 'assistant' AND "conversation_messages"."turn_id" IS NOT NULL)),
	CONSTRAINT "conversation_messages_policy_valid" CHECK (("conversation_messages"."role" = 'user' AND "conversation_messages"."delivery_policy" IS NOT NULL AND "conversation_messages"."delivery_policy" IN ('queue', 'steer')) OR ("conversation_messages"."role" = 'assistant' AND "conversation_messages"."delivery_policy" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "conversation_turn_inputs" (
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "conversation_turn_inputs_turn_id_message_id_pk" PRIMARY KEY("turn_id","message_id"),
	CONSTRAINT "conversation_turn_inputs_ordinal_nonnegative" CHECK ("conversation_turn_inputs"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"running_text" text,
	"checkpoint_version" integer DEFAULT 0 NOT NULL,
	"retry_of_id" uuid,
	"allocation_operation_id" uuid,
	"runtime_url" text,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_turns_parent_id_unique" UNIQUE("conversation_id","id"),
	CONSTRAINT "conversation_turns_status_valid" CHECK ("conversation_turns"."status" IN ('queued', 'running', 'completed', 'no-support', 'incomplete')),
	CONSTRAINT "conversation_turns_reason_valid" CHECK (("conversation_turns"."status" = 'incomplete' AND "conversation_turns"."reason" IN ('failed', 'cancelled') AND "conversation_turns"."reason" IS NOT NULL) OR ("conversation_turns"."status" <> 'incomplete' AND "conversation_turns"."reason" IS NULL)),
	CONSTRAINT "conversation_turns_checkpoint_valid" CHECK ("conversation_turns"."checkpoint_version" >= 0 AND ("conversation_turns"."status" = 'running' OR "conversation_turns"."running_text" IS NULL)),
	CONSTRAINT "conversation_turns_retry_distinct" CHECK ("conversation_turns"."retry_of_id" IS NULL OR "conversation_turns"."retry_of_id" <> "conversation_turns"."id"),
	CONSTRAINT "conversation_turns_runtime_complete" CHECK (("conversation_turns"."allocation_operation_id" IS NULL AND "conversation_turns"."runtime_url" IS NULL AND "conversation_turns"."session_id" IS NULL) OR ("conversation_turns"."allocation_operation_id" IS NOT NULL AND "conversation_turns"."runtime_url" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"queue_paused" boolean DEFAULT false NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_sequence_positive" CHECK ("conversations"."next_sequence" > 0)
);
--> statement-breakpoint
ALTER TABLE "conversation_citations" ADD CONSTRAINT "conversation_citations_message_parent_fk" FOREIGN KEY ("conversation_id","message_id") REFERENCES "public"."conversation_messages"("conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_turn_parent_fk" FOREIGN KEY ("conversation_id","turn_id") REFERENCES "public"."conversation_turns"("conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turn_inputs" ADD CONSTRAINT "conversation_turn_inputs_turn_parent_fk" FOREIGN KEY ("conversation_id","turn_id") REFERENCES "public"."conversation_turns"("conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turn_inputs" ADD CONSTRAINT "conversation_turn_inputs_message_parent_fk" FOREIGN KEY ("conversation_id","message_id") REFERENCES "public"."conversation_messages"("conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_retry_parent_fk" FOREIGN KEY ("conversation_id","retry_of_id") REFERENCES "public"."conversation_turns"("conversation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_citations_note_idx" ON "conversation_citations" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "conversation_cleanup_retry_idx" ON "conversation_cleanup_intents" USING btree ("retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_sequence_idx" ON "conversation_messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_operation_idx" ON "conversation_messages" USING btree ("conversation_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_turn_idx" ON "conversation_messages" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turn_inputs_order_idx" ON "conversation_turn_inputs" USING btree ("turn_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turns_operation_idx" ON "conversation_turns" USING btree ("conversation_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turns_running_idx" ON "conversation_turns" USING btree ("conversation_id") WHERE "conversation_turns"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turns_allocation_idx" ON "conversation_turns" USING btree ("allocation_operation_id");--> statement-breakpoint
CREATE INDEX "conversations_owner_created_idx" ON "conversations" USING btree ("owner_id","created_at","id");