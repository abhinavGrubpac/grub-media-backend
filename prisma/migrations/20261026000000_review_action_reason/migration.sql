-- Structured review decision reason: keep the dropdown/label separate from
-- free-form comments in the immutable review trail. Additive and nullable;
-- older rows and clients without a reason continue to work.
ALTER TABLE "ReviewAction" ADD COLUMN IF NOT EXISTS "reason" TEXT;
