-- CreativeVersion.submittedAt drift fix.
--
-- Environments built from the migration chain have camelCase "submittedAt"
-- only (see 20261007151000_creative_review). Legacy Neon layouts additionally
-- carry snake_case "submitted_at", whose values had to be preserved.
--
-- Both steps are guarded so this migration is a no-op on databases that do
-- not have the legacy column (fresh deploys, prod, CI scratch databases) —
-- an unguarded backfill referenced "submitted_at" and crashed the chain.

ALTER TABLE "CreativeVersion" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CreativeVersion'
      AND column_name = 'submitted_at'
  ) THEN
    UPDATE "CreativeVersion"
    SET "submittedAt" = "submitted_at"
    WHERE "submittedAt" IS NULL AND "submitted_at" IS NOT NULL;
  END IF;
END $$;
