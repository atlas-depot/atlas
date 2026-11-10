CREATE TABLE "note_search_admissions" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"admitted_at" timestamp with time zone[] DEFAULT ARRAY[]::timestamptz[] NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_search_admissions_bounded" CHECK (cardinality("note_search_admissions"."admitted_at") <= 20)
);
--> statement-breakpoint
CREATE INDEX "note_search_admissions_expiry_idx" ON "note_search_admissions" USING btree ("expires_at");