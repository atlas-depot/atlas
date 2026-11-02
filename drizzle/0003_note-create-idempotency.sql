CREATE TABLE "note_create_requests" (
	"owner_id" text NOT NULL,
	"key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"note_id" uuid NOT NULL,
	CONSTRAINT "note_create_requests_owner_id_key_pk" PRIMARY KEY("owner_id","key")
);
