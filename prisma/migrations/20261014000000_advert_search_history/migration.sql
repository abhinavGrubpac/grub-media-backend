-- Advert control: recent search history for the 7-day revisit window.
-- Params are stored as JSON so future filters stay backward compatible.

-- CreateTable
CREATE TABLE "AdvertSearchHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvertSearchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdvertSearchHistory_userId_createdAt_idx" ON "AdvertSearchHistory"("userId", "createdAt");
