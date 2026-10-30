-- Reference library: thumbnails were dropped from the requirements (no doc
-- preview image is ever uploaded), so the unused thumbnailUrl column goes
-- with them. The S3 objects themselves are untouched by this migration.

ALTER TABLE "ReferenceDoc" DROP COLUMN IF EXISTS "thumbnailUrl";
