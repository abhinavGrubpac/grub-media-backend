-- Creative review: approval threads (Creative), version increments
-- (CreativeVersion) and the immutable decision trail (ReviewAction).

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ON_HOLD', 'NEEDS_CHANGES', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('APPROVE', 'REJECT', 'HOLD', 'REQUEST_CHANGES');

-- CreateTable
CREATE TABLE "Creative" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "creativeName" TEXT NOT NULL,
    "externalRefId" TEXT,
    "currentVersionId" TEXT,
    "upstreamCreativeId" TEXT,
    "upstreamAgencyId" TEXT,
    "campaignRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Creative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeVersion" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "mediaUrl" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "upstreamVersionId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAction" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "ActionType" NOT NULL,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Creative_upstreamCreativeId_key" ON "Creative"("upstreamCreativeId");

-- CreateIndex
CREATE INDEX "Creative_brandId_idx" ON "Creative"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeVersion_upstreamVersionId_key" ON "CreativeVersion"("upstreamVersionId");

-- CreateIndex
CREATE INDEX "CreativeVersion_creativeId_idx" ON "CreativeVersion"("creativeId");

-- CreateIndex
CREATE INDEX "CreativeVersion_status_idx" ON "CreativeVersion"("status");

-- CreateIndex
CREATE INDEX "ReviewAction_versionId_idx" ON "ReviewAction"("versionId");

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeVersion" ADD CONSTRAINT "CreativeVersion_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAction" ADD CONSTRAINT "ReviewAction_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CreativeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
