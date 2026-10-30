-- Media snapshot for the advert revisit list (GET /adverts/searches/recent).
-- All additive; the sibling backend ignores unknown columns.

ALTER TABLE "AdvertSearchHistory" ADD COLUMN IF NOT EXISTS "preview" JSONB;
