-- Flatten the action taxonomy onto the log row itself: `actionName` replaces the
-- `actionId` FK, the ticket-style `referenceId` column is removed, and the
-- `log_action` table is dropped entirely.

-- AlterTable
ALTER TABLE "log" ADD COLUMN "actionName" TEXT;

-- Backfill: copy every existing action name onto its rows before the FK and the
-- taxonomy table disappear.
UPDATE "log" SET "actionName" = la."name" FROM "log_action" la WHERE "log"."actionId" = la."id";

-- AlterTable: drop the FK first so the columns can go
ALTER TABLE "log" DROP CONSTRAINT "log_actionId_fkey";

-- DropIndex: must happen before dropping the column it is built on
DROP INDEX "idx_action";

-- AlterTable
ALTER TABLE "log" DROP COLUMN "actionId";
ALTER TABLE "log" DROP COLUMN "referenceId";

-- CreateIndex
CREATE INDEX "idx_type_action" ON "log"("typeEnum", "actionName");

-- DropTable: also drops uk_name_category and idx_action_category
DROP TABLE "log_action";
