ALTER TABLE "notes" ALTER COLUMN "content" SET DATA TYPE jsonb USING to_jsonb("content");
