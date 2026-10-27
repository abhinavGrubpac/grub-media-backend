-- Fix schema drift: production has roleId FK, but schema expects role enum.
-- This migration safely:
-- 1. Ensures the role enum type exists
-- 2. Ensures the role column exists with enum values
-- 3. Drops the old roleId FK if present
-- 4. Handles data integrity (migrates roleId→role if both exist)

DO $$
BEGIN
  -- Ensure UserRole enum exists
  IF to_regtype('"UserRole"') IS NULL THEN
    CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'EMPLOYEE');
  END IF;

  -- Add role column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'User' AND column_name = 'role'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE';
  END IF;

  -- If roleId exists, migrate roleId→role based on ID to enum mapping
  -- Assuming: roleId 1=SUPER_ADMIN, 2=ADMIN, 3=EMPLOYEE
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'User' AND column_name = 'roleId'
  ) THEN
    -- Migrate data from roleId to role
    UPDATE "User" 
    SET "role" = CASE "roleId"
      WHEN 1 THEN 'SUPER_ADMIN'
      WHEN 2 THEN 'ADMIN'
      WHEN 3 THEN 'EMPLOYEE'
      ELSE 'EMPLOYEE'
    END::"UserRole"
    WHERE "roleId" IS NOT NULL;
  END IF;
END
$$;

-- Drop roleId FK constraint if it exists
DO $$
BEGIN
  ALTER TABLE "User" 
  DROP CONSTRAINT IF EXISTS "User_roleId_fkey";
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

-- Drop roleId column if it exists
ALTER TABLE "User" 
DROP COLUMN IF EXISTS "roleId";

-- Drop Role table if it exists (no longer needed)
DROP TABLE IF EXISTS "Role" CASCADE;
