--------------UP
-- Fix cycle-check arg order in fn_location_update.
CREATE OR REPLACE FUNCTION organization.fn_location_update(
    p_organization_id    VARCHAR,
    p_id                 INTEGER,
    p_name               VARCHAR DEFAULT NULL,
    p_parent_location_id INTEGER DEFAULT NULL,
    p_clear_parent       BOOLEAN DEFAULT FALSE,
    p_sort_order         INTEGER DEFAULT NULL,
    p_kind_fields        JSONB   DEFAULT NULL,
    p_custom_fields      JSONB   DEFAULT NULL
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
BEGIN
    IF p_clear_parent THEN
        UPDATE organization.locations AS l
        SET parent_location_id = NULL,
            name = COALESCE(p_name, l.name),
            sort_order = COALESCE(p_sort_order, l.sort_order),
            custom_fields = COALESCE(p_custom_fields, l.custom_fields),
            updated_at = NOW()
        WHERE l.id = p_id AND l.organization_id = p_organization_id;
    ELSIF p_parent_location_id IS NOT NULL THEN
        -- Reject if self is an ancestor of the proposed parent (would cycle).
        IF p_parent_location_id = p_id OR organization.fn_location_is_ancestor(
            p_organization_id, p_parent_location_id, p_id
        ) THEN
            RAISE EXCEPTION 'parent_location_id % would create a cycle',
                p_parent_location_id USING ERRCODE = '22023';
        END IF;
        UPDATE organization.locations AS l
        SET parent_location_id = p_parent_location_id,
            name = COALESCE(p_name, l.name),
            sort_order = COALESCE(p_sort_order, l.sort_order),
            custom_fields = COALESCE(p_custom_fields, l.custom_fields),
            updated_at = NOW()
        WHERE l.id = p_id AND l.organization_id = p_organization_id;
    ELSE
        UPDATE organization.locations AS l
        SET name = COALESCE(p_name, l.name),
            sort_order = COALESCE(p_sort_order, l.sort_order),
            custom_fields = COALESCE(p_custom_fields, l.custom_fields),
            updated_at = NOW()
        WHERE l.id = p_id AND l.organization_id = p_organization_id;
    END IF;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF p_kind_fields IS NOT NULL THEN
        PERFORM organization.fn_location_apply_kind_fields(p_id, p_kind_fields);
    END IF;

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
    WHERE l.id = p_id AND l.organization_id = p_organization_id;
END;
$$;
--------------DOWN
-- Revert handled by re-running 6106 migration.
