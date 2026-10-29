-- Recurring daily display window for adverts (separate from the exact
-- campaign start_date/end_date timestamps). The media RDS already has these
-- nullable TEXT columns in some environments, so creation stays idempotent.
ALTER TABLE "Advert" ADD COLUMN IF NOT EXISTS "time_slot_start" TEXT;
ALTER TABLE "Advert" ADD COLUMN IF NOT EXISTS "time_slot_end" TEXT;

CREATE INDEX IF NOT EXISTS "Advert_time_slot_start_time_slot_end_idx"
  ON "Advert" ("time_slot_start", "time_slot_end");
