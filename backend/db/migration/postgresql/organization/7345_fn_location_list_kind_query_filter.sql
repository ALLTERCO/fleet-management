--------------UP
-- Location.List has accepted (and validated) `kind` and `query` since the
-- per-kind rewrite, but fn_location_list never had a parameter to receive
-- them, so both were dropped between the RPC schema and the SQL. A caller
-- asking for {kind:'floor', limit:1} got the first row of the whole org and
-- a total for the whole org, with no way to detect the loss from the result.
--
-- Both predicates live in `filtered`, the CTE `counted` counts, so items and
-- total_count come from one WHERE clause and cannot diverge.

BEGIN;

-- Argument list grows by p_kind + p_query — drop the prior signature so the
-- overload cannot stay behind and make the call ambiguous.
DROP FUNCTION IF EXISTS organization.fn_location_list(
    VARCHAR, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER[],
    BOOLEAN, VARCHAR[], INTEGER[], INTEGER[]);

CREATE OR REPLACE FUNCTION organization.fn_location_list(
    p_organization_id     VARCHAR,
    p_parent_id           INTEGER DEFAULT NULL,
    p_roots_only          BOOLEAN DEFAULT FALSE,
    p_limit               INTEGER DEFAULT 200,
    p_offset              INTEGER DEFAULT 0,
    p_allowed_ids         INTEGER[] DEFAULT NULL,
    p_include_summary     BOOLEAN DEFAULT FALSE,
    p_allowed_device_ids  VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids   INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids     INTEGER[] DEFAULT NULL,
    p_kind                VARCHAR DEFAULT NULL,
    p_query               VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, kind VARCHAR,
    parent_location_id INTEGER, sort_order INTEGER,
    timezone VARCHAR, address JSONB, geo JSONB,
    country_code VARCHAR, region_code VARCHAR, currency VARCHAR,
    regulatory_zone VARCHAR, site_type VARCHAR, building_type VARCHAR,
    room_type VARCHAR, operational_tier VARCHAR, access_procedure VARCHAR,
    energy_certification VARCHAR, floor_number INTEGER, floor_count INTEGER,
    gross_floor_area NUMERIC, year_built INTEGER, capacity INTEGER,
    room_number VARCHAR, compliance_tags TEXT[], operating_hours JSONB,
    primary_contact JSONB, emergency_contact JSONB,
    environmental_setpoint JSONB, custom_fields JSONB, metadata JSONB,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
    c_child_locations       BIGINT, c_devices BIGINT, c_entities BIGINT,
    c_tags BIGINT, c_descendant_devices BIGINT,
    c_descendant_entities BIGINT, c_groups_referencing BIGINT,
    total_count BIGINT
)
LANGUAGE sql STABLE
AS $$
    WITH filtered AS (
        SELECT l.*
        FROM organization.locations l
        WHERE l.organization_id = p_organization_id
          AND (p_allowed_ids IS NULL OR l.id = ANY(p_allowed_ids))
          AND (
              (p_roots_only IS TRUE AND l.parent_location_id IS NULL)
              OR (p_roots_only IS FALSE AND p_parent_id IS NULL)
              OR (p_parent_id IS NOT NULL AND l.parent_location_id = p_parent_id)
          )
          AND (p_kind IS NULL OR l.kind = p_kind)
          AND (p_query IS NULL OR l.name ILIKE '%' || p_query || '%')
    ),
    counted AS (SELECT COUNT(*)::BIGINT AS c FROM filtered)
    SELECT
        f.id, f.organization_id, f.name, f.kind,
        f.parent_location_id, f.sort_order,
        f.timezone, f.address, f.geo,
        f.country_code, f.region_code, f.currency,
        f.regulatory_zone, f.site_type, f.building_type,
        f.room_type, f.operational_tier, f.access_procedure,
        f.energy_certification, f.floor_number, f.floor_count,
        f.gross_floor_area, f.year_built, f.capacity,
        f.room_number, f.compliance_tags, f.operating_hours,
        f.primary_contact, f.emergency_contact,
        f.environmental_setpoint, f.custom_fields, f.metadata,
        f.created_at, f.updated_at,
        CASE WHEN p_include_summary
             THEN (SELECT COUNT(*) FROM organization.locations c
                   WHERE c.parent_location_id = f.id)::BIGINT
             ELSE NULL END AS c_child_locations,
        NULL::BIGINT, NULL::BIGINT, NULL::BIGINT,
        NULL::BIGINT, NULL::BIGINT, NULL::BIGINT,
        c.c AS total_count
    FROM filtered f
    CROSS JOIN counted c
    ORDER BY f.sort_order, f.name
    LIMIT p_limit OFFSET p_offset;
$$;

-- Same (organization_id, <typed column>) shape as the site_type/building_type/
-- room_type indexes — kind is now a filter column, so it gets the same support.
CREATE INDEX IF NOT EXISTS locations_kind_idx
    ON organization.locations (organization_id, kind);

COMMIT;

--------------DOWN
BEGIN;

DROP INDEX IF EXISTS organization.locations_kind_idx;

DROP FUNCTION IF EXISTS organization.fn_location_list(
    VARCHAR, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER[],
    BOOLEAN, VARCHAR[], INTEGER[], INTEGER[], VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION organization.fn_location_list(
    p_organization_id     VARCHAR,
    p_parent_id           INTEGER DEFAULT NULL,
    p_roots_only          BOOLEAN DEFAULT FALSE,
    p_limit               INTEGER DEFAULT 200,
    p_offset              INTEGER DEFAULT 0,
    p_allowed_ids         INTEGER[] DEFAULT NULL,
    p_include_summary     BOOLEAN DEFAULT FALSE,
    p_allowed_device_ids  VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids   INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids     INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, kind VARCHAR,
    parent_location_id INTEGER, sort_order INTEGER,
    timezone VARCHAR, address JSONB, geo JSONB,
    country_code VARCHAR, region_code VARCHAR, currency VARCHAR,
    regulatory_zone VARCHAR, site_type VARCHAR, building_type VARCHAR,
    room_type VARCHAR, operational_tier VARCHAR, access_procedure VARCHAR,
    energy_certification VARCHAR, floor_number INTEGER, floor_count INTEGER,
    gross_floor_area NUMERIC, year_built INTEGER, capacity INTEGER,
    room_number VARCHAR, compliance_tags TEXT[], operating_hours JSONB,
    primary_contact JSONB, emergency_contact JSONB,
    environmental_setpoint JSONB, custom_fields JSONB, metadata JSONB,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
    c_child_locations       BIGINT, c_devices BIGINT, c_entities BIGINT,
    c_tags BIGINT, c_descendant_devices BIGINT,
    c_descendant_entities BIGINT, c_groups_referencing BIGINT,
    total_count BIGINT
)
LANGUAGE sql STABLE
AS $$
    WITH filtered AS (
        SELECT l.*
        FROM organization.locations l
        WHERE l.organization_id = p_organization_id
          AND (p_allowed_ids IS NULL OR l.id = ANY(p_allowed_ids))
          AND (
              (p_roots_only IS TRUE AND l.parent_location_id IS NULL)
              OR (p_roots_only IS FALSE AND p_parent_id IS NULL)
              OR (p_parent_id IS NOT NULL AND l.parent_location_id = p_parent_id)
          )
    ),
    counted AS (SELECT COUNT(*)::BIGINT AS c FROM filtered)
    SELECT
        f.id, f.organization_id, f.name, f.kind,
        f.parent_location_id, f.sort_order,
        f.timezone, f.address, f.geo,
        f.country_code, f.region_code, f.currency,
        f.regulatory_zone, f.site_type, f.building_type,
        f.room_type, f.operational_tier, f.access_procedure,
        f.energy_certification, f.floor_number, f.floor_count,
        f.gross_floor_area, f.year_built, f.capacity,
        f.room_number, f.compliance_tags, f.operating_hours,
        f.primary_contact, f.emergency_contact,
        f.environmental_setpoint, f.custom_fields, f.metadata,
        f.created_at, f.updated_at,
        CASE WHEN p_include_summary
             THEN (SELECT COUNT(*) FROM organization.locations c
                   WHERE c.parent_location_id = f.id)::BIGINT
             ELSE NULL END AS c_child_locations,
        NULL::BIGINT, NULL::BIGINT, NULL::BIGINT,
        NULL::BIGINT, NULL::BIGINT, NULL::BIGINT,
        c.c AS total_count
    FROM filtered f
    CROSS JOIN counted c
    ORDER BY f.sort_order, f.name
    LIMIT p_limit OFFSET p_offset;
$$;

COMMIT;
