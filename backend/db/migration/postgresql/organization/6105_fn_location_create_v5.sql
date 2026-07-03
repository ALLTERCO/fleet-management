--------------UP
-- Disambiguate column references — RETURNS TABLE columns shadow bare
-- column names in the IF EXISTS subquery. Alias the table (l.*).
CREATE OR REPLACE FUNCTION organization.fn_location_create(
    p_organization_id    VARCHAR,
    p_name               VARCHAR,
    p_kind               VARCHAR,
    p_parent_location_id INTEGER DEFAULT NULL,
    p_sort_order         INTEGER DEFAULT 0,
    p_kind_fields        JSONB   DEFAULT '{}'::jsonb,
    p_custom_fields      JSONB   DEFAULT '{}'::jsonb
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
    environmental_setpoint JSONB, custom_fields JSONB,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_id INTEGER;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    IF p_parent_location_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM organization.locations l
            WHERE l.id = p_parent_location_id
              AND l.organization_id = p_organization_id
        ) THEN
            RAISE EXCEPTION 'parent_location_id % not found in organization %',
                p_parent_location_id, p_organization_id
                USING ERRCODE = '22023';
        END IF;
    END IF;

    INSERT INTO organization.locations (
        organization_id, name, kind, parent_location_id, sort_order,
        metadata, custom_fields
    )
    VALUES (
        p_organization_id, p_name, p_kind, p_parent_location_id,
        COALESCE(p_sort_order, 0),
        '{}'::jsonb, COALESCE(p_custom_fields, '{}'::jsonb)
    )
    RETURNING locations.id INTO v_id;

    PERFORM organization.fn_location_apply_kind_fields(v_id, p_kind_fields);

    RETURN QUERY
    SELECT l.id, l.organization_id, l.name, l.kind,
           l.parent_location_id, l.sort_order,
           l.timezone, l.address, l.geo,
           l.country_code, l.region_code, l.currency,
           l.regulatory_zone, l.site_type, l.building_type,
           l.room_type, l.operational_tier, l.access_procedure,
           l.energy_certification, l.floor_number, l.floor_count,
           l.gross_floor_area, l.year_built, l.capacity,
           l.room_number, l.compliance_tags, l.operating_hours,
           l.primary_contact, l.emergency_contact,
           l.environmental_setpoint, l.custom_fields,
           l.created_at, l.updated_at
    FROM organization.locations l
    WHERE l.id = v_id;
END;
$$;
--------------DOWN
-- Revert handled by re-running 6101 migration.
