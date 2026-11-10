CREATE TABLE "conversation_admissions" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"admitted_at" timestamp with time zone[] DEFAULT ARRAY[]::timestamptz[] NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_admissions_bounded" CHECK (cardinality("conversation_admissions"."admitted_at") <= 20)
);
--> statement-breakpoint
ALTER TABLE "conversation_turn_inputs" ADD COLUMN "steer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_turn_inputs" ADD COLUMN "delivery_id" text;--> statement-breakpoint
ALTER TABLE "conversation_turns" ADD COLUMN "delivery_id" text;--> statement-breakpoint
CREATE INDEX "conversation_admissions_expiry_idx" ON "conversation_admissions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "conversation_turn_inputs" ADD CONSTRAINT "conversation_turn_inputs_delivery_steer" CHECK ("conversation_turn_inputs"."steer" OR "conversation_turn_inputs"."delivery_id" IS NULL);