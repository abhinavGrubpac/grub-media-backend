-- Neon drift fix: CreativeVersion has legacy snake_case "submitted_at" but the
-- Prisma schema (and prod-truth migration 20261007151000_creative_review) uses
-- camelCase "submittedAt". The list/detail advert queries include the whole
-- version row, so the missing column breaks GET /adverts with P2022.
-- IF NOT EXISTS keeps this safe on databases that already have the column.
-- Backfill from the legacy column so existing submission timestamps are kept.

ALTER TABLE "CreativeVersion" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);

UPDATE "CreativeVersion"
SET "submittedAt" = "submitted_at"
WHERE "submittedAt" IS NULL AND "submitted_at" IS NOT NULL;
