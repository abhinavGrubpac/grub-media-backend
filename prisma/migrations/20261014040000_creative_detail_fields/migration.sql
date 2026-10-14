-- Creative detail view: last-viewed tracking, agency location, brand flag
-- attribution. All additive; the sibling backend ignores unknown columns.

ALTER TABLE "Creative" ADD COLUMN IF NOT EXISTS "lastViewedBy" TEXT;
ALTER TABLE "Creative" ADD COLUMN IF NOT EXISTS "lastViewedAt" TIMESTAMP(3);

ALTER TABLE "AgencyRef" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "AgencyRef" ADD COLUMN IF NOT EXISTS "address" TEXT;

ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "flaggedBy" TEXT;
ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "flaggedOn" TIMESTAMP(3);
