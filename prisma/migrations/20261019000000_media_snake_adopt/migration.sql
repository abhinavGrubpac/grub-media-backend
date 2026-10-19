-- Media snake_case adopt — aligns chain-built databases with the Prisma schema.
--
-- The 20261007150000..20261007154000 migrations created the media tables with
-- camelCase columns, while the Prisma schema maps the 7 media models to
-- snake_case (the shared-database convention, see docs/neon-alignment-bridge).
-- A database built purely from the chain therefore cannot serve the current
-- application (P2022 "column does not exist" on media reads).
--
-- This migration reconciles such databases, and is a safe no-op on databases
-- that already carry the snake_case set (Neon):
--   1. adds the snake_case columns the schema expects (IF NOT EXISTS);
--   2. ports data that only lives in camelCase columns (idempotent backfill);
--   3. relaxes NOT NULL on the retired camelCase columns so application
--      inserts that write only the snake_case set still pass;
--   4. adds the snake_case indexes / foreign keys / composite key declared in
--      the schema.
--
-- It never drops tables, columns or rows. Retired camelCase columns are
-- intentionally kept (nullable) — dropping them would be unrecoverable on
-- databases that still hold camelCase-only data.

-- ---------------------------------------------------------------------------
-- Brand
-- ---------------------------------------------------------------------------

ALTER TABLE "Brand"
  ADD COLUMN IF NOT EXISTS "brand_name" TEXT,
  ADD COLUMN IF NOT EXISTS "industry_category" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_email" TEXT,
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS "auto_approve" BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS "upstream_brand_id" TEXT,
  ADD COLUMN IF NOT EXISTS "upstream_agency_id" TEXT,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Brand' AND column_name = 'brandName') THEN
    UPDATE "Brand" SET "brand_name" = "brandName" WHERE "brand_name" IS NULL AND "brandName" IS NOT NULL;
    UPDATE "Brand" SET "industry_category" = "industryCategory" WHERE "industry_category" IS NULL AND "industryCategory" IS NOT NULL;
    UPDATE "Brand" SET "contact_email" = "contactEmail" WHERE "contact_email" IS NULL AND "contactEmail" IS NOT NULL;
    UPDATE "Brand" SET "is_active" = "isActive" WHERE "is_active" IS NULL AND "isActive" IS NOT NULL;
    UPDATE "Brand" SET "auto_approve" = "autoApprove" WHERE "auto_approve" IS NULL AND "autoApprove" IS NOT NULL;
    UPDATE "Brand" SET "upstream_brand_id" = "upstreamBrandId" WHERE "upstream_brand_id" IS NULL AND "upstreamBrandId" IS NOT NULL;
    UPDATE "Brand" SET "upstream_agency_id" = "upstreamAgencyId" WHERE "upstream_agency_id" IS NULL AND "upstreamAgencyId" IS NOT NULL;
    UPDATE "Brand" SET "created_at" = "createdAt" WHERE "created_at" IS NULL AND "createdAt" IS NOT NULL;
    UPDATE "Brand" SET "updated_at" = "updatedAt" WHERE "updated_at" IS NULL AND "updatedAt" IS NOT NULL;
    ALTER TABLE "Brand"
      ALTER COLUMN "brandName" DROP NOT NULL,
      ALTER COLUMN "industryCategory" DROP NOT NULL,
      ALTER COLUMN "contactEmail" DROP NOT NULL,
      ALTER COLUMN "isActive" DROP NOT NULL,
      ALTER COLUMN "autoApprove" DROP NOT NULL,
      ALTER COLUMN "upstreamBrandId" DROP NOT NULL,
      ALTER COLUMN "upstreamAgencyId" DROP NOT NULL,
      ALTER COLUMN "createdAt" DROP NOT NULL,
      ALTER COLUMN "updatedAt" DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Brand" WHERE "brand_name" IS NULL) THEN
    ALTER TABLE "Brand" ALTER COLUMN "brand_name" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Brand" WHERE "is_active" IS NULL) THEN
    ALTER TABLE "Brand" ALTER COLUMN "is_active" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Brand" WHERE "auto_approve" IS NULL) THEN
    ALTER TABLE "Brand" ALTER COLUMN "auto_approve" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Brand" WHERE "created_at" IS NULL) THEN
    ALTER TABLE "Brand" ALTER COLUMN "created_at" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Brand" WHERE "updated_at" IS NULL) THEN
    ALTER TABLE "Brand" ALTER COLUMN "updated_at" SET NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Brand_brand_name_key" ON "Brand"("brand_name");
CREATE UNIQUE INDEX IF NOT EXISTS "Brand_upstream_brand_id_key" ON "Brand"("upstream_brand_id");
CREATE INDEX IF NOT EXISTS "Brand_upstream_agency_id_idx" ON "Brand"("upstream_agency_id");
CREATE INDEX IF NOT EXISTS "Brand_is_active_idx" ON "Brand"("is_active");
CREATE INDEX IF NOT EXISTS "Brand_auto_approve_idx" ON "Brand"("auto_approve");
CREATE INDEX IF NOT EXISTS "Brand_industry_category_idx" ON "Brand"("industry_category");

-- ---------------------------------------------------------------------------
-- Creative
-- ---------------------------------------------------------------------------

ALTER TABLE "Creative"
  ADD COLUMN IF NOT EXISTS "brand_id" TEXT,
  ADD COLUMN IF NOT EXISTS "creative_name" TEXT,
  ADD COLUMN IF NOT EXISTS "external_ref_id" TEXT,
  ADD COLUMN IF NOT EXISTS "current_version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "upstream_creative_id" TEXT,
  ADD COLUMN IF NOT EXISTS "upstream_agency_id" TEXT,
  ADD COLUMN IF NOT EXISTS "campaign_ref" TEXT,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Creative' AND column_name = 'creativeName') THEN
    UPDATE "Creative" SET "brand_id" = "brandId" WHERE "brand_id" IS NULL AND "brandId" IS NOT NULL;
    UPDATE "Creative" SET "creative_name" = "creativeName" WHERE "creative_name" IS NULL AND "creativeName" IS NOT NULL;
    UPDATE "Creative" SET "external_ref_id" = "externalRefId" WHERE "external_ref_id" IS NULL AND "externalRefId" IS NOT NULL;
    UPDATE "Creative" SET "current_version_id" = "currentVersionId" WHERE "current_version_id" IS NULL AND "currentVersionId" IS NOT NULL;
    UPDATE "Creative" SET "upstream_creative_id" = "upstreamCreativeId" WHERE "upstream_creative_id" IS NULL AND "upstreamCreativeId" IS NOT NULL;
    UPDATE "Creative" SET "upstream_agency_id" = "upstreamAgencyId" WHERE "upstream_agency_id" IS NULL AND "upstreamAgencyId" IS NOT NULL;
    UPDATE "Creative" SET "campaign_ref" = "campaignRef" WHERE "campaign_ref" IS NULL AND "campaignRef" IS NOT NULL;
    UPDATE "Creative" SET "created_at" = "createdAt" WHERE "created_at" IS NULL AND "createdAt" IS NOT NULL;
    ALTER TABLE "Creative"
      ALTER COLUMN "brandId" DROP NOT NULL,
      ALTER COLUMN "creativeName" DROP NOT NULL,
      ALTER COLUMN "externalRefId" DROP NOT NULL,
      ALTER COLUMN "currentVersionId" DROP NOT NULL,
      ALTER COLUMN "upstreamCreativeId" DROP NOT NULL,
      ALTER COLUMN "upstreamAgencyId" DROP NOT NULL,
      ALTER COLUMN "campaignRef" DROP NOT NULL,
      ALTER COLUMN "createdAt" DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Creative" WHERE "brand_id" IS NULL) THEN
    ALTER TABLE "Creative" ALTER COLUMN "brand_id" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Creative" WHERE "creative_name" IS NULL) THEN
    ALTER TABLE "Creative" ALTER COLUMN "creative_name" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Creative" WHERE "created_at" IS NULL) THEN
    ALTER TABLE "Creative" ALTER COLUMN "created_at" SET NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Creative_upstream_creative_id_key" ON "Creative"("upstream_creative_id");
CREATE INDEX IF NOT EXISTS "Creative_brand_id_idx" ON "Creative"("brand_id");

-- ---------------------------------------------------------------------------
-- CreativeVersion
-- ---------------------------------------------------------------------------

ALTER TABLE "CreativeVersion"
  ADD COLUMN IF NOT EXISTS "creative_id" TEXT,
  ADD COLUMN IF NOT EXISTS "version_number" INTEGER,
  ADD COLUMN IF NOT EXISTS "media_url" TEXT,
  ADD COLUMN IF NOT EXISTS "media_type" TEXT,
  ADD COLUMN IF NOT EXISTS "media_name" TEXT,
  ADD COLUMN IF NOT EXISTS "created_by" TEXT,
  ADD COLUMN IF NOT EXISTS "upstream_version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CreativeVersion' AND column_name = 'mediaUrl') THEN
    UPDATE "CreativeVersion" SET "creative_id" = "creativeId" WHERE "creative_id" IS NULL AND "creativeId" IS NOT NULL;
    UPDATE "CreativeVersion" SET "version_number" = "versionNumber" WHERE "version_number" IS NULL AND "versionNumber" IS NOT NULL;
    UPDATE "CreativeVersion" SET "media_url" = "mediaUrl" WHERE "media_url" IS NULL AND "mediaUrl" IS NOT NULL;
    UPDATE "CreativeVersion" SET "media_type" = "mediaType" WHERE "media_type" IS NULL AND "mediaType" IS NOT NULL;
    UPDATE "CreativeVersion" SET "created_by" = "createdBy" WHERE "created_by" IS NULL AND "createdBy" IS NOT NULL;
    UPDATE "CreativeVersion" SET "upstream_version_id" = "upstreamVersionId" WHERE "upstream_version_id" IS NULL AND "upstreamVersionId" IS NOT NULL;
    UPDATE "CreativeVersion" SET "created_at" = "createdAt" WHERE "created_at" IS NULL AND "createdAt" IS NOT NULL;
    UPDATE "CreativeVersion" SET "submitted_at" = "submittedAt" WHERE "submitted_at" IS NULL AND "submittedAt" IS NOT NULL;
    ALTER TABLE "CreativeVersion"
      ALTER COLUMN "creativeId" DROP NOT NULL,
      ALTER COLUMN "versionNumber" DROP NOT NULL,
      ALTER COLUMN "mediaUrl" DROP NOT NULL,
      ALTER COLUMN "mediaType" DROP NOT NULL,
      ALTER COLUMN "createdBy" DROP NOT NULL,
      ALTER COLUMN "upstreamVersionId" DROP NOT NULL,
      ALTER COLUMN "createdAt" DROP NOT NULL,
      ALTER COLUMN "submittedAt" DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CreativeVersion" WHERE "creative_id" IS NULL) THEN
    ALTER TABLE "CreativeVersion" ALTER COLUMN "creative_id" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "CreativeVersion" WHERE "version_number" IS NULL) THEN
    ALTER TABLE "CreativeVersion" ALTER COLUMN "version_number" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "CreativeVersion" WHERE "media_url" IS NULL) THEN
    ALTER TABLE "CreativeVersion" ALTER COLUMN "media_url" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "CreativeVersion" WHERE "media_type" IS NULL) THEN
    ALTER TABLE "CreativeVersion" ALTER COLUMN "media_type" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "CreativeVersion" WHERE "created_by" IS NULL) THEN
    ALTER TABLE "CreativeVersion" ALTER COLUMN "created_by" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "CreativeVersion" WHERE "created_at" IS NULL) THEN
    ALTER TABLE "CreativeVersion" ALTER COLUMN "created_at" SET NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CreativeVersion_upstream_version_id_key" ON "CreativeVersion"("upstream_version_id");
CREATE INDEX IF NOT EXISTS "CreativeVersion_creative_id_idx" ON "CreativeVersion"("creative_id");

-- ---------------------------------------------------------------------------
-- ReviewAction
-- ---------------------------------------------------------------------------

ALTER TABLE "ReviewAction"
  ADD COLUMN IF NOT EXISTS "version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "actor_id" TEXT,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ReviewAction' AND column_name = 'versionId') THEN
    UPDATE "ReviewAction" SET "version_id" = "versionId" WHERE "version_id" IS NULL AND "versionId" IS NOT NULL;
    UPDATE "ReviewAction" SET "actor_id" = "actorId" WHERE "actor_id" IS NULL AND "actorId" IS NOT NULL;
    UPDATE "ReviewAction" SET "created_at" = "createdAt" WHERE "created_at" IS NULL AND "createdAt" IS NOT NULL;
    ALTER TABLE "ReviewAction"
      ALTER COLUMN "versionId" DROP NOT NULL,
      ALTER COLUMN "actorId" DROP NOT NULL,
      ALTER COLUMN "createdAt" DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ReviewAction" WHERE "version_id" IS NULL) THEN
    ALTER TABLE "ReviewAction" ALTER COLUMN "version_id" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ReviewAction" WHERE "actor_id" IS NULL) THEN
    ALTER TABLE "ReviewAction" ALTER COLUMN "actor_id" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ReviewAction" WHERE "created_at" IS NULL) THEN
    ALTER TABLE "ReviewAction" ALTER COLUMN "created_at" SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ReviewAction_version_id_idx" ON "ReviewAction"("version_id");

-- ---------------------------------------------------------------------------
-- ReferenceDoc
-- ---------------------------------------------------------------------------

ALTER TABLE "ReferenceDoc"
  ADD COLUMN IF NOT EXISTS "file_url" TEXT,
  ADD COLUMN IF NOT EXISTS "published_on" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS "archived_on" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ReferenceDoc' AND column_name = 'fileUrl') THEN
    UPDATE "ReferenceDoc" SET "file_url" = "fileUrl" WHERE "file_url" IS NULL AND "fileUrl" IS NOT NULL;
    UPDATE "ReferenceDoc" SET "published_on" = "publishedOn" WHERE "published_on" IS NULL AND "publishedOn" IS NOT NULL;
    UPDATE "ReferenceDoc" SET "is_archived" = "isArchived" WHERE "is_archived" IS NULL AND "isArchived" IS NOT NULL;
    UPDATE "ReferenceDoc" SET "archived_on" = "archivedOn" WHERE "archived_on" IS NULL AND "archivedOn" IS NOT NULL;
    UPDATE "ReferenceDoc" SET "created_at" = "createdAt" WHERE "created_at" IS NULL AND "createdAt" IS NOT NULL;
    UPDATE "ReferenceDoc" SET "updated_at" = "updatedAt" WHERE "updated_at" IS NULL AND "updatedAt" IS NOT NULL;
    ALTER TABLE "ReferenceDoc"
      ALTER COLUMN "fileUrl" DROP NOT NULL,
      ALTER COLUMN "publishedOn" DROP NOT NULL,
      ALTER COLUMN "isArchived" DROP NOT NULL,
      ALTER COLUMN "archivedOn" DROP NOT NULL,
      ALTER COLUMN "createdAt" DROP NOT NULL,
      ALTER COLUMN "updatedAt" DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ReferenceDoc" WHERE "file_url" IS NULL) THEN
    ALTER TABLE "ReferenceDoc" ALTER COLUMN "file_url" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ReferenceDoc" WHERE "is_archived" IS NULL) THEN
    ALTER TABLE "ReferenceDoc" ALTER COLUMN "is_archived" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ReferenceDoc" WHERE "created_at" IS NULL) THEN
    ALTER TABLE "ReferenceDoc" ALTER COLUMN "created_at" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ReferenceDoc" WHERE "updated_at" IS NULL) THEN
    ALTER TABLE "ReferenceDoc" ALTER COLUMN "updated_at" SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ReferenceDoc_is_archived_archived_on_idx" ON "ReferenceDoc"("is_archived", "archived_on");

-- ---------------------------------------------------------------------------
-- CreativeReference
-- ---------------------------------------------------------------------------

ALTER TABLE "CreativeReference"
  ADD COLUMN IF NOT EXISTS "version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "doc_id" TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CreativeReference' AND column_name = 'versionId') THEN
    UPDATE "CreativeReference" SET "version_id" = "versionId" WHERE "version_id" IS NULL AND "versionId" IS NOT NULL;
    UPDATE "CreativeReference" SET "doc_id" = "docId" WHERE "doc_id" IS NULL AND "docId" IS NOT NULL;

    -- Retire the camelCase composite primary key if it is the active one; a
    -- primary key forces values into both column sets on every insert. The
    -- snake_case primary key is (re)created at the end of this migration.
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'CreativeReference_pkey'
        AND conrelid = 'public."CreativeReference"'::regclass
        AND pg_get_constraintdef(oid) LIKE '%"versionId"%'
    ) THEN
      ALTER TABLE "CreativeReference" DROP CONSTRAINT "CreativeReference_pkey";
    END IF;

    -- Relax camelCase NOT NULL only when the columns are not pinned by a
    -- primary key (a PostgreSQL primary key column cannot be DROP NOT NULL).
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'public."CreativeReference"'::regclass
        AND i.indisprimary
        AND a.attname = 'versionId'
    ) THEN
      ALTER TABLE "CreativeReference" ALTER COLUMN "versionId" DROP NOT NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'public."CreativeReference"'::regclass
        AND i.indisprimary
        AND a.attname = 'docId'
    ) THEN
      ALTER TABLE "CreativeReference" ALTER COLUMN "docId" DROP NOT NULL;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CreativeReference_pkey'
      AND conrelid = 'public."CreativeReference"'::regclass
  ) AND NOT EXISTS (
    SELECT 1 FROM "CreativeReference" WHERE "version_id" IS NULL OR "doc_id" IS NULL
  ) THEN
    ALTER TABLE "CreativeReference" ADD CONSTRAINT "CreativeReference_pkey" PRIMARY KEY ("version_id", "doc_id");
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Advert
-- ---------------------------------------------------------------------------

ALTER TABLE "Advert"
  ADD COLUMN IF NOT EXISTS "version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "address_text" TEXT,
  ADD COLUMN IF NOT EXISTS "radius_km" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "start_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "end_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "image_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "upstream_advert_id" TEXT,
  ADD COLUMN IF NOT EXISTS "city_name" TEXT,
  ADD COLUMN IF NOT EXISTS "zone_name" TEXT,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Advert' AND column_name = 'versionId') THEN
    UPDATE "Advert" SET "version_id" = "versionId" WHERE "version_id" IS NULL AND "versionId" IS NOT NULL;
    UPDATE "Advert" SET "address_text" = "addressText" WHERE "address_text" IS NULL AND "addressText" IS NOT NULL;
    UPDATE "Advert" SET "radius_km" = "radiusKm" WHERE "radius_km" IS NULL AND "radiusKm" IS NOT NULL;
    UPDATE "Advert" SET "start_date" = "startDate" WHERE "start_date" IS NULL AND "startDate" IS NOT NULL;
    UPDATE "Advert" SET "end_date" = "endDate" WHERE "end_date" IS NULL AND "endDate" IS NOT NULL;
    UPDATE "Advert" SET "image_hash" = "imageHash" WHERE "image_hash" IS NULL AND "imageHash" IS NOT NULL;
    UPDATE "Advert" SET "upstream_advert_id" = "upstreamAdvertId" WHERE "upstream_advert_id" IS NULL AND "upstreamAdvertId" IS NOT NULL;
    UPDATE "Advert" SET "city_name" = "cityName" WHERE "city_name" IS NULL AND "cityName" IS NOT NULL;
    UPDATE "Advert" SET "zone_name" = "zoneName" WHERE "zone_name" IS NULL AND "zoneName" IS NOT NULL;
    UPDATE "Advert" SET "created_at" = "createdAt" WHERE "created_at" IS NULL AND "createdAt" IS NOT NULL;
    ALTER TABLE "Advert"
      ALTER COLUMN "versionId" DROP NOT NULL,
      ALTER COLUMN "addressText" DROP NOT NULL,
      ALTER COLUMN "radiusKm" DROP NOT NULL,
      ALTER COLUMN "startDate" DROP NOT NULL,
      ALTER COLUMN "endDate" DROP NOT NULL,
      ALTER COLUMN "imageHash" DROP NOT NULL,
      ALTER COLUMN "upstreamAdvertId" DROP NOT NULL,
      ALTER COLUMN "cityName" DROP NOT NULL,
      ALTER COLUMN "zoneName" DROP NOT NULL,
      ALTER COLUMN "createdAt" DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Advert" WHERE "version_id" IS NULL) THEN
    ALTER TABLE "Advert" ALTER COLUMN "version_id" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Advert" WHERE "start_date" IS NULL) THEN
    ALTER TABLE "Advert" ALTER COLUMN "start_date" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Advert" WHERE "end_date" IS NULL) THEN
    ALTER TABLE "Advert" ALTER COLUMN "end_date" SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Advert" WHERE "created_at" IS NULL) THEN
    ALTER TABLE "Advert" ALTER COLUMN "created_at" SET NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Advert_upstream_advert_id_key" ON "Advert"("upstream_advert_id");
CREATE INDEX IF NOT EXISTS "Advert_version_id_idx" ON "Advert"("version_id");

-- ---------------------------------------------------------------------------
-- Foreign keys (snake_case column sets)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Creative_brand_id_fkey' AND conrelid = 'public."Creative"'::regclass) THEN
    ALTER TABLE "Creative" ADD CONSTRAINT "Creative_brand_id_fkey"
      FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreativeVersion_creative_id_fkey' AND conrelid = 'public."CreativeVersion"'::regclass) THEN
    ALTER TABLE "CreativeVersion" ADD CONSTRAINT "CreativeVersion_creative_id_fkey"
      FOREIGN KEY ("creative_id") REFERENCES "Creative"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReviewAction_version_id_fkey' AND conrelid = 'public."ReviewAction"'::regclass) THEN
    ALTER TABLE "ReviewAction" ADD CONSTRAINT "ReviewAction_version_id_fkey"
      FOREIGN KEY ("version_id") REFERENCES "CreativeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreativeReference_version_id_fkey' AND conrelid = 'public."CreativeReference"'::regclass) THEN
    ALTER TABLE "CreativeReference" ADD CONSTRAINT "CreativeReference_version_id_fkey"
      FOREIGN KEY ("version_id") REFERENCES "CreativeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreativeReference_doc_id_fkey' AND conrelid = 'public."CreativeReference"'::regclass) THEN
    ALTER TABLE "CreativeReference" ADD CONSTRAINT "CreativeReference_doc_id_fkey"
      FOREIGN KEY ("doc_id") REFERENCES "ReferenceDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Advert_version_id_fkey' AND conrelid = 'public."Advert"'::regclass) THEN
    ALTER TABLE "Advert" ADD CONSTRAINT "Advert_version_id_fkey"
      FOREIGN KEY ("version_id") REFERENCES "CreativeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
