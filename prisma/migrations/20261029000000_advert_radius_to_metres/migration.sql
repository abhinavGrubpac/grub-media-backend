-- Advert coverage radius: km -> metres (full metres cutover).
-- Contract change: the API now speaks metres everywhere (radius_m), so the
-- stored column follows. Values are converted in place (x1000).
ALTER TABLE "Advert" RENAME COLUMN "radius_km" TO "radius_m";

UPDATE "Advert" SET "radius_m" = "radius_m" * 1000 WHERE "radius_m" IS NOT NULL;
