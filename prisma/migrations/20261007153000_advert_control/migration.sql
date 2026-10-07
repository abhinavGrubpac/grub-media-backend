-- Advert control: physical deployments of approved creatives. The location
-- column is PostGIS (Unsupported to Prisma Client — writes go through raw SQL),
-- with a GiST index for ST_DWithin radius searches.

CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "AdvertStatus" AS ENUM ('SCHEDULED', 'LIVE', 'PAUSED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "Advert" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "location" geometry(Point, 4326) NOT NULL,
    "addressText" TEXT,
    "status" "AdvertStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "imageHash" TEXT,
    "upstreamAdvertId" TEXT,
    "cityName" TEXT,
    "zoneName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Advert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Advert_upstreamAdvertId_key" ON "Advert"("upstreamAdvertId");

-- CreateIndex
CREATE INDEX "Advert_versionId_idx" ON "Advert"("versionId");

-- CreateIndex
CREATE INDEX "Advert_status_idx" ON "Advert"("status");

-- Geo index on the Unsupported column (not representable in schema.prisma)
CREATE INDEX "Advert_location_gist" ON "Advert" USING GIST ("location");

-- AddForeignKey
ALTER TABLE "Advert" ADD CONSTRAINT "Advert_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CreativeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
