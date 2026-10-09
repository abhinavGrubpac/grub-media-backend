-- CreateTable
CREATE TABLE "help_categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "displayOrder" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "help_faqs" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "help_categories_isActive_displayOrder_idx" ON "help_categories"("isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "help_faqs_categoryId_isActive_idx" ON "help_faqs"("categoryId", "isActive");

-- AddForeignKey
ALTER TABLE "help_faqs" ADD CONSTRAINT "help_faqs_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "help_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
