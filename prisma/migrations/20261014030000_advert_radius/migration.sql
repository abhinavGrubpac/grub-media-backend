-- Advert coverage radius (km) for map display. Nullable: older rows predate it.
-- Sibling backend ignores unknown columns.
-- camelCase like the rest of this history (schema.prisma has no @map here).

ALTER TABLE "Advert" ADD COLUMN IF NOT EXISTS "radiusKm" DOUBLE PRECISION;
