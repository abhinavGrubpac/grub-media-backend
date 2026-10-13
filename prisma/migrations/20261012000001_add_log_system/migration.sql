-- CreateEnum
CREATE TYPE "LogType" AS ENUM ('SYSTEM', 'ACTIVITY', 'EMPLOYEE');

-- CreateTable
CREATE TABLE "log" (
    "id" SERIAL NOT NULL,
    "typeEnum" "LogType" NOT NULL,
    "categoryId" INTEGER,
    "actionId" INTEGER,
    "actionText" TEXT,
    "message" TEXT,
    "userId" TEXT,
    "empId" TEXT,
    "oldDetail" TEXT,
    "newDetail" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_categories" (
    "id" SERIAL NOT NULL,
    "typeEnum" "LogType" NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,

    CONSTRAINT "log_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_action" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "log_action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_type_date" ON "log"("typeEnum", "createdAt");

-- CreateIndex
CREATE INDEX "idx_category" ON "log"("categoryId");

-- CreateIndex
CREATE INDEX "idx_action" ON "log"("actionId");

-- CreateIndex
CREATE INDEX "idx_user" ON "log"("userId");

-- CreateIndex
CREATE INDEX "idx_message" ON "log"("message");

-- CreateIndex
CREATE INDEX "idx_type_cat_date" ON "log"("typeEnum", "categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_log_type" ON "log_categories"("typeEnum");

-- CreateIndex
CREATE UNIQUE INDEX "uk_name_type" ON "log_categories"("name", "typeEnum");

-- CreateIndex
CREATE INDEX "idx_action_category" ON "log_action"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "uk_name_category" ON "log_action"("name", "categoryId");

-- AddForeignKey
ALTER TABLE "log" ADD CONSTRAINT "log_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "log_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log" ADD CONSTRAINT "log_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "log_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_action" ADD CONSTRAINT "log_action_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "log_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
