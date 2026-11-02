-- A creative's external ref is its stable identity inside a brand. The review
-- UI renders that ref as the row id, so repeated POST /creatives calls with
-- the same ref used to show up as duplicate creatives.
--
-- Merge existing duplicates (oldest creative wins; the other threads' versions
-- are appended chronologically) before enforcing the composite key.

DROP TABLE IF EXISTS _creative_dup_map;
CREATE TEMP TABLE _creative_dup_map AS
SELECT c.id AS duplicate_id, survivor.survivor_id
FROM "Creative" c
JOIN (
  SELECT DISTINCT ON (brand_id, external_ref_id)
         brand_id,
         external_ref_id,
         id AS survivor_id
  FROM "Creative"
  WHERE external_ref_id IS NOT NULL
  ORDER BY brand_id, external_ref_id, created_at, id
) survivor
  ON survivor.brand_id = c.brand_id
 AND survivor.external_ref_id = c.external_ref_id
WHERE c.id <> survivor.survivor_id;

-- Renumber the entire merged thread chronologically so version numbers stay
-- meaningful after the histories are combined.
DROP TABLE IF EXISTS _creative_version_renumber;
CREATE TEMP TABLE _creative_version_renumber AS
SELECT v.id AS version_id,
       merged.survivor_id,
       ROW_NUMBER() OVER (
         PARTITION BY merged.survivor_id
         ORDER BY v.created_at, v.id
       ) AS new_number
FROM "CreativeVersion" v
JOIN (
  SELECT duplicate_id AS creative_id, survivor_id FROM _creative_dup_map
  UNION
  SELECT DISTINCT survivor_id, survivor_id FROM _creative_dup_map
) merged ON merged.creative_id = v.creative_id;

UPDATE "CreativeVersion" cv
SET creative_id = r.survivor_id,
    version_number = r.new_number
FROM _creative_version_renumber r
WHERE cv.id = r.version_id;

-- The newest version in the merged thread becomes the creative's current one.
UPDATE "Creative" c
SET current_version_id = latest.version_id
FROM (
  SELECT r.survivor_id,
         (ARRAY_AGG(r.version_id ORDER BY r.new_number DESC))[1] AS version_id
  FROM _creative_version_renumber r
  GROUP BY r.survivor_id
) latest
WHERE c.id = latest.survivor_id;

-- Preserve identifiers that only existed on a merged duplicate.
UPDATE "Creative" c
SET upstream_creative_id = COALESCE(c.upstream_creative_id, merged.upstream_creative_id),
    upstream_agency_id = COALESCE(c.upstream_agency_id, merged.upstream_agency_id),
    campaign_ref = COALESCE(c.campaign_ref, merged.campaign_ref)
FROM (
  SELECT m.survivor_id,
         MIN(d.upstream_creative_id) AS upstream_creative_id,
         MIN(d.upstream_agency_id) AS upstream_agency_id,
         MIN(d.campaign_ref) AS campaign_ref
  FROM _creative_dup_map m
  JOIN "Creative" d ON d.id = m.duplicate_id
  GROUP BY m.survivor_id
) merged
WHERE c.id = merged.survivor_id;

DELETE FROM "Creative" c
USING _creative_dup_map m
WHERE c.id = m.duplicate_id;

DROP TABLE IF EXISTS _creative_version_renumber;
DROP TABLE IF EXISTS _creative_dup_map;

CREATE UNIQUE INDEX IF NOT EXISTS "Creative_brandId_externalRefId_key"
ON "Creative" ("brand_id", "external_ref_id");
