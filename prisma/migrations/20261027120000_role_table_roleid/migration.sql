-- Separate Role table: User.roleId (FK) replaces the User.role enum column.
-- Exactly three system roles are inserted here so the backfill can join on
-- name and the FK is satisfied; prisma/seed.ts upserts the same rows later,
-- so re-running the seed cannot duplicate them.
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

INSERT INTO "Role" ("id", "name")
VALUES
  ('role_super_admin', 'SUPER_ADMIN'),
  ('role_admin', 'ADMIN'),
  ('role_employee', 'EMPLOYEE');

-- Backfill: every existing user keeps the role it already had, matched by
-- name; anything unexpected falls back to EMPLOYEE.
ALTER TABLE "User" ADD COLUMN "roleId" TEXT;

UPDATE "User"
SET    "roleId" = (SELECT r."id" FROM "Role" r WHERE r."name"::text = "User"."role"::text);

UPDATE "User" SET "roleId" = 'role_employee' WHERE "roleId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;

ALTER TABLE "User"
  ADD CONSTRAINT "User_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- The column itself is gone; the "UserRole" enum TYPE stays in the database
-- so it matches schema.prisma (kept as the canonical name set) and future
-- `prisma migrate dev` runs do not flag drift.
ALTER TABLE "User" DROP COLUMN "role";
-- Migration created to match database drift (already applied)
