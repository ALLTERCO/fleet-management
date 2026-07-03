--------------UP
-- Per-kind field redesign — promote the frequently-queried fields out of
-- the old catch-all metadata JSONB into typed columns. Structured sub-
-- documents (operating_hours / contacts / environmental_setpoint / geo /
-- address) stay JSONB because they're read as a whole, not filtered on.
-- custom_fields is the org-specific escape hatch.

ALTER TABLE organization.locations
    ADD COLUMN country_code           VARCHAR(2),
    ADD COLUMN region_code            VARCHAR(8),
    ADD COLUMN currency               VARCHAR(3),
    ADD COLUMN regulatory_zone        VARCHAR(32),
    ADD COLUMN site_type              VARCHAR(32),
    ADD COLUMN building_type          VARCHAR(32),
    ADD COLUMN room_type              VARCHAR(32),
    ADD COLUMN operational_tier       VARCHAR(32),
    ADD COLUMN access_procedure       VARCHAR(32),
    ADD COLUMN energy_certification   VARCHAR(32),
    ADD COLUMN floor_number           INTEGER,
    ADD COLUMN floor_count            INTEGER,
    ADD COLUMN gross_floor_area       NUMERIC(12, 2),
    ADD COLUMN year_built             INTEGER,
    ADD COLUMN capacity               INTEGER,
    ADD COLUMN room_number            VARCHAR(32),
    ADD COLUMN compliance_tags        TEXT[],
    ADD COLUMN operating_hours        JSONB,
    ADD COLUMN primary_contact        JSONB,
    ADD COLUMN emergency_contact      JSONB,
    ADD COLUMN environmental_setpoint JSONB,
    ADD COLUMN custom_fields          JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Indexes for the filter/query columns.
CREATE INDEX locations_country_code_idx
    ON organization.locations (organization_id, country_code);
CREATE INDEX locations_site_type_idx
    ON organization.locations (organization_id, site_type);
CREATE INDEX locations_building_type_idx
    ON organization.locations (organization_id, building_type);
CREATE INDEX locations_room_type_idx
    ON organization.locations (organization_id, room_type);
CREATE INDEX locations_operational_tier_idx
    ON organization.locations (organization_id, operational_tier);
CREATE INDEX locations_compliance_tags_gin
    ON organization.locations USING GIN (compliance_tags);

-- Best-effort backfill from existing metadata so historic rows populate
-- the typed columns. Keeps original metadata intact — nothing lost.
UPDATE organization.locations
SET country_code = NULLIF(address->>'countryCode', '')
WHERE country_code IS NULL AND address IS NOT NULL;

UPDATE organization.locations
SET custom_fields = metadata
WHERE (custom_fields IS NULL OR custom_fields = '{}'::jsonb)
  AND metadata IS NOT NULL AND metadata <> '{}'::jsonb;

--------------DOWN
DROP INDEX IF EXISTS organization.locations_compliance_tags_gin;
DROP INDEX IF EXISTS organization.locations_operational_tier_idx;
DROP INDEX IF EXISTS organization.locations_room_type_idx;
DROP INDEX IF EXISTS organization.locations_building_type_idx;
DROP INDEX IF EXISTS organization.locations_site_type_idx;
DROP INDEX IF EXISTS organization.locations_country_code_idx;
ALTER TABLE organization.locations
    DROP COLUMN IF EXISTS custom_fields,
    DROP COLUMN IF EXISTS environmental_setpoint,
    DROP COLUMN IF EXISTS emergency_contact,
    DROP COLUMN IF EXISTS primary_contact,
    DROP COLUMN IF EXISTS operating_hours,
    DROP COLUMN IF EXISTS compliance_tags,
    DROP COLUMN IF EXISTS room_number,
    DROP COLUMN IF EXISTS capacity,
    DROP COLUMN IF EXISTS year_built,
    DROP COLUMN IF EXISTS gross_floor_area,
    DROP COLUMN IF EXISTS floor_count,
    DROP COLUMN IF EXISTS floor_number,
    DROP COLUMN IF EXISTS energy_certification,
    DROP COLUMN IF EXISTS access_procedure,
    DROP COLUMN IF EXISTS operational_tier,
    DROP COLUMN IF EXISTS room_type,
    DROP COLUMN IF EXISTS building_type,
    DROP COLUMN IF EXISTS site_type,
    DROP COLUMN IF EXISTS regulatory_zone,
    DROP COLUMN IF EXISTS currency,
    DROP COLUMN IF EXISTS region_code,
    DROP COLUMN IF EXISTS country_code;
