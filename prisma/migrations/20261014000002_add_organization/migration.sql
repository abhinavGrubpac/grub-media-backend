-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Organization" (
    "id"           TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "regNumber"    TEXT,
    "logoUrl"      TEXT,
    "jurisdiction" TEXT,
    "status"       "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy"    TEXT,
    "updatedBy"    TEXT,
    "deletedAt"    TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_regNumber_key" ON "Organization"("regNumber");
CREATE INDEX "Organization_deletedAt_idx" ON "Organization"("deletedAt");

-- AlterTable: rename logoUrl → avatarUrl on User
ALTER TABLE "User" RENAME COLUMN "logoUrl" TO "avatarUrl";

-- AlterTable: drop flat organizationName (now derived from FK join)
ALTER TABLE "User" DROP COLUMN IF EXISTS "organizationName";

-- AlterTable: drop old plain string organizationId, re-add as FK
ALTER TABLE "User" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
