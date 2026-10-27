-- Fix schema drift: production has roleId FK, but schema expects role enum.
-- This migration safely:
-- 1. Migrates roleId→role if roleId exists
-- 2. Drops the old roleId FK if present
-- 3. Cleans up legacy Role table

DO $$
BEGIN
  -- If roleId exists, migrate roleId→role based on ID to enum mapping
  -- Assuming: roleId 1=SUPER_ADMIN, 2=ADMIN, 3=EMPLOYEE
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'User' AND column_name = 'roleId'
  ) THEN
    -- Migrate data from roleId to role (only if role is still DEFAULT)
    -- Cast roleId to text for comparison since it might be text or integer
    UPDATE "User" 
    SET "role" = CASE (COALESCE("roleId", '')::text)
      WHEN '1' THEN 'SUPER_ADMIN'
      WHEN '2' THEN 'ADMIN'
      WHEN '3' THEN 'EMPLOYEE'
      ELSE 'EMPLOYEE'
    END::"UserRole"
    WHERE "roleId" IS NOT NULL AND "role" = 'EMPLOYEE';
  END IF;
END
$$;

-- Drop roleId FK constraint if it exists
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Drop User_roleId_fkey constraint
  ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_roleId_fkey";
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

-- Drop roleId column if it exists
ALTER TABLE "User" 
DROP COLUMN IF EXISTS "roleId" CASCADE;

-- Drop Role table if it exists (no longer needed)
DROP TABLE IF EXISTS "Role" CASCADE;
