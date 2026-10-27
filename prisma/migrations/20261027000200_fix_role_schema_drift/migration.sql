-- Align legacy databases that still use the Role table with production, where
-- User.role is the UserRole enum. This migration is intentionally idempotent:
-- fresh databases already have the enum column and no roleId/Role objects.
DO $$
BEGIN
  IF to_regtype('"UserRole"') IS NULL THEN
    CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'EMPLOYEE');
  END IF;
END
$$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE';

-- Preserve role assignments. Legacy databases used either the text role IDs
-- (role_super_admin, role_admin, role_employee) or numeric placeholders.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'roleId'
  ) THEN
    UPDATE "User"
    SET "role" = CASE (COALESCE("roleId", '')::text)
      WHEN 'role_super_admin' THEN 'SUPER_ADMIN'
      WHEN 'role_admin' THEN 'ADMIN'
      WHEN 'role_employee' THEN 'EMPLOYEE'
      WHEN '1' THEN 'SUPER_ADMIN'
      WHEN '2' THEN 'ADMIN'
      WHEN '3' THEN 'EMPLOYEE'
      ELSE 'EMPLOYEE'
    END::"UserRole"
    WHERE "roleId" IS NOT NULL;
  END IF;
END
$$;

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_roleId_fkey";
DROP INDEX IF EXISTS "User_roleId_idx";

ALTER TABLE "User" DROP COLUMN IF EXISTS "roleId" CASCADE;
DROP TABLE IF EXISTS "Role" CASCADE;
