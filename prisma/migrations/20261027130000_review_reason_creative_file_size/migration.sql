-- Structured decision reason on review actions and stored file size on
-- creative versions. Both columns already exist in some environments, so the
-- migration is idempotent.
ALTER TABLE "ReviewAction" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "CreativeVersion" ADD COLUMN IF NOT EXISTS "file_size_bytes" INTEGER;
