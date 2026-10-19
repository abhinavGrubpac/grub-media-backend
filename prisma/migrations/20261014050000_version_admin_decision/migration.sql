-- Admin-portal decision context on versions (display only; govt review is
-- unaffected). All additive; the sibling backend ignores unknown columns.

ALTER TABLE "CreativeVersion" ADD COLUMN IF NOT EXISTS "adminApprovedBy" TEXT;
ALTER TABLE "CreativeVersion" ADD COLUMN IF NOT EXISTS "adminApprovedAt" TIMESTAMP(3);
ALTER TABLE "CreativeVersion" ADD COLUMN IF NOT EXISTS "adminComments" TEXT;
