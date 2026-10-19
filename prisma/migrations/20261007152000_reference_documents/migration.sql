-- Reference documents: regulatory library. Documents are archived, never
-- deleted, so past review decisions keep their justifications.

-- CreateTable
CREATE TABLE "ReferenceDoc" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "publishedOn" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeReference" (
    "versionId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,

    CONSTRAINT "CreativeReference_pkey" PRIMARY KEY ("versionId","docId")
);

-- CreateIndex
CREATE INDEX "ReferenceDoc_category_idx" ON "ReferenceDoc"("category");

-- AddForeignKey
ALTER TABLE "CreativeReference" ADD CONSTRAINT "CreativeReference_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CreativeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeReference" ADD CONSTRAINT "CreativeReference_docId_fkey" FOREIGN KEY ("docId") REFERENCES "ReferenceDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
