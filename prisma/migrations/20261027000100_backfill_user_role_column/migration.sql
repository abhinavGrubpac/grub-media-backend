-- Fix schema drift where User.role is missing in older databases.
-- Required for auth/login and any Prisma User reads because Prisma selects all model columns.
DO $$
BEGIN
  IF to_regtype('"UserRole"') IS NULL THEN
    CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'EMPLOYEE');
  END IF;
END
$$;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE';
