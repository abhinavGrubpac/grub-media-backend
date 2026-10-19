-- Review resume action: ON_HOLD versions return to PENDING via RESUME.
-- NOTE: PostgreSQL cannot run ALTER TYPE ... ADD VALUE inside a transaction,
-- so `prisma migrate deploy` fails on this file. Apply once out of band:
--   npx prisma db execute --file <this file> --schema prisma/schema.prisma
-- (Fresh `migrate deploy` runs on empty DBs hit the same limitation.)

ALTER TYPE "ActionType" ADD VALUE 'RESUME';
