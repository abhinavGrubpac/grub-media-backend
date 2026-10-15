-- Government audit trail: one row per review/advert transition plus
-- upstream-attributed intake writes (UPSTREAM_INTEGRATION_API.md 10.3).
-- Table is GovActivityLog (not ActivityLog): the legacy sibling backend owns
-- a different-shaped ActivityLog, so this portal writes its own table.

-- CreateTable
CREATE TABLE "GovActivityLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "requestId" TEXT,
    "ip" TEXT,
    "metadata" JSONB,
    "upstreamEventId" TEXT,
    "upstreamPortal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GovActivityLog_entityType_entityId_idx" ON "GovActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "GovActivityLog_createdAt_idx" ON "GovActivityLog"("createdAt");
