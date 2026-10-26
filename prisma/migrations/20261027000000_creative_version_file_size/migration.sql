-- Track the uploaded media size per creative version so review can show
-- storage totals (including every version of a creative).
ALTER TABLE "CreativeVersion"
  ADD COLUMN IF NOT EXISTS "file_size_bytes" INTEGER;
