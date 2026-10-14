-- Advert coverage radius (km) for map display. Nullable: older rows predate it.
-- Sibling backend ignores unknown columns.

ALTER TABLE "Advert" ADD COLUMN IF NOT EXISTS "radius_km" DOUBLE PRECISION;
