-- Reverse-image search must cover approved creatives before they are deployed
-- as adverts (the government portal has no upstream schedule rows yet).
ALTER TABLE "CreativeVersion" ADD COLUMN IF NOT EXISTS "image_hash" TEXT;
