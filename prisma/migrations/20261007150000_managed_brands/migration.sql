-- Managed brands: identity fields arrive from upstream; the compliance overlay
-- (isActive / autoApprove / isFlagged) is owned by this portal.

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "industryCategory" TEXT,
    "contactEmail" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "upstreamBrandId" TEXT,
    "upstreamAgencyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyRef" (
    "id" TEXT NOT NULL,
    "upstreamAgencyId" TEXT NOT NULL,
    "agencyName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_brandName_key" ON "Brand"("brandName");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_upstreamBrandId_key" ON "Brand"("upstreamBrandId");

-- CreateIndex
CREATE INDEX "Brand_upstreamAgencyId_idx" ON "Brand"("upstreamAgencyId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyRef_upstreamAgencyId_key" ON "AgencyRef"("upstreamAgencyId");
