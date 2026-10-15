-- Manage-brands gaps: logo + address display fields, filter/sort/export indexes.
-- (DB uses camelCase like the existing Brand table.)

ALTER TABLE "Brand" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "Brand" ADD COLUMN "address" TEXT;

CREATE INDEX "Brand_isFlagged_idx" ON "Brand"("isFlagged");
CREATE INDEX "Brand_isActive_idx" ON "Brand"("isActive");
CREATE INDEX "Brand_autoApprove_idx" ON "Brand"("autoApprove");
CREATE INDEX "Brand_industryCategory_idx" ON "Brand"("industryCategory");
