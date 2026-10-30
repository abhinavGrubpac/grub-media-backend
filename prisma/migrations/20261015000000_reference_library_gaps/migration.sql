-- Reference library gaps: thumbnail (first-page preview), file size audit,
-- title search + archive/published sorting, bulk restore / hard delete support.

-- Add thumbnail + file-size columns (DB uses camelCase like the existing table).
ALTER TABLE "ReferenceDoc" ADD COLUMN "thumbnailUrl" TEXT;
ALTER TABLE "ReferenceDoc" ADD COLUMN "fileSizeBytes" INTEGER;

-- Speed up name search (GET /references?search=) and archived-tab sorting.
CREATE INDEX "ReferenceDoc_title_idx" ON "ReferenceDoc"("title");
CREATE INDEX "ReferenceDoc_isArchived_archivedOn_idx" ON "ReferenceDoc"("isArchived", "archivedOn");
