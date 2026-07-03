--------------UP
-- Persist + return visualization sub-fields (floor plan / device placements /
-- zone overlays) via the existing `metadata` JSONB column. All four CRUD
-- functions are recreated to add `metadata` to their RETURNS TABLE + SELECT.
-- Update keeps the v6 cycle-check fix (org-scoped fn_location_is_ancestor).

CREATE OR REPLACE FUNCTION organization.fn_location_apply_kind_fields(
    p_id INTEGER, p_kind_fields JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_viz JSONB;
BEGIN
    UPDATE organization.locations SET
        timezone              = NULLIF(p_kind_fields->>'timezone', ''),
        country_code          = NULLIF(p_kind_fields->>'countryCode', ''),
        region_code           = NULLIF(p_kind_fields->>'regionCode', ''),
        currency              = NULLIF(p_kind_fields->>'currency', ''),
        regulatory_zone       = NULLIF(p_kind_fields->>'regulatoryZone', ''),
        site_type             = NULLIF(p_kind_fields->>'siteType', ''),
        building_type         = NULLIF(p_kind_fields->>'buildingType', ''),
        room_type             = NULLIF(p_kind_fields->>'roomType', ''),
        operational_tier      = NULLIF(p_kind_fields->>'operationalTier', ''),
        access_procedure      = NULLIF(p_kind_fields->>'accessProcedure', ''),
        energy_certification  = NULLIF(p_kind_fields->>'energyCertification', ''),
        room_number           = NULLIF(p_kind_fields->>'roomNumber', ''),
        floor_number          = CASE WHEN p_kind_fields ? 'floorNumber'
                                     THEN (p_kind_fields->>'floorNumber')::INTEGER
                                     ELSE NULL END,
        floor_count           = CASE WHEN p_kind_fields ? 'floorCount'
                                     THEN (p_kind_fields->>'floorCount')::INTEGER
                                     ELSE NULL END,
        gross_floor_area      = CASE WHEN p_kind_fields ? 'grossFloorArea'
                                     THEN (p_kind_fields->>'grossFloorArea')::NUMERIC
                                     ELSE NULL END,
        year_built            = CASE WHEN p_kind_fields ? 'yearBuilt'
                                     THEN (p_kind_fields->>'yearBuilt')::INTEGER
                                     ELSE NULL END,
        capacity              = CASE WHEN p_kind_fields ? 'capacity'
                                     THEN (p_kind_fields->>'capacity')::INTEGER
                                     ELSE NULL END,
        address               = p_kind_fields->'address',
        geo                   = p_kind_fields->'geo',
        operating_hours       = p_kind_fields->'operatingHours',
        primary_contact       = p_kind_fields->'primaryContact',
        emergency_contact     = p_kind_fields->'emergencyContact',
        environmental_setpoint = p_kind_fields->'environmentalSetpoint',
        compliance_tags       = CASE WHEN p_kind_fields ? 'complianceTags'
                                     THEN ARRAY(
                                         SELECT jsonb_array_elements_text(
                                             p_kind_fields->'complianceTags'))
                                     ELSE NULL END
    WHERE id = p_id;

    -- Visualization sub-fields live under metadata.viz. jsonb_strip_nulls
    -- omits any sub-key the caller didn't send so a partial patch from one
    -- screen doesn't clobber sub-keys touched by another screen.
    v_viz := jsonb_strip_nulls(jsonb_build_object(
        'floorPlan',         p_kind_fields->'floorPlan',
        'devicePlacements',  p_kind_fields->'devicePlacements',
        'zones',             p_kind_fields->'zones'
    ));

    IF v_viz <> '{}'::jsonb THEN
        UPDATE organization.locations
        SET metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object('viz',
                           COALESCE(metadata->'viz', '{}'::jsonb) || v_viz)
        WHERE id = p_id;
    END IF;
END;
$$;

-- RETURNS TABLE gains `metadata` — drop the prior v5 signature before recreate.
DROP FUNCTION IF EXISTS organization.fn_location_create(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, JSONB, JSONB);

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
    environmental_setpoint JSONB, custom_fields JSONB, metadata JSONB,
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
           l.environmental_setpoint, l.custom_fields, l.metadata,
           l.created_at, l.updated_at
    FROM organization.locations l
    WHERE l.id = v_id;
END;
$$;

-- RETURNS TABLE gains `metadata` — drop the prior v6 signature before recreate.
DROP FUNCTION IF EXISTS organization.fn_location_update(
    VARCHAR, INTEGER, VARCHAR, INTEGER, BOOLEAN, INTEGER, JSONB, JSONB);

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
    environmental_setpoint JSONB, custom_fields JSONB, metadata JSONB,
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
           l.environmental_setpoint, l.custom_fields, l.metadata,
           l.created_at, l.updated_at
    FROM organization.locations l
    WHERE l.id = p_id AND l.organization_id = p_organization_id;
END;
$$;

-- RETURNS TABLE gains `metadata` — drop the prior v6 signature before recreate.
-- CREATE OR REPLACE FUNCTION cannot change a function's return-type shape;
-- earlier v6 migration installed this with a narrower RETURNS TABLE.
DROP FUNCTION IF EXISTS organization.fn_location_get(
    VARCHAR, INTEGER, BOOLEAN, INTEGER[], VARCHAR[], INTEGER[], INTEGER[]);

CREATE OR REPLACE FUNCTION organization.fn_location_get(
    p_organization_id       VARCHAR,
    p_id                    INTEGER,
    p_include_summary       BOOLEAN DEFAULT FALSE,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids     INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids       INTEGER[] DEFAULT NULL
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
    c_descendant_entities BIGINT, c_groups_referencing BIGINT
)
LANGUAGE sql STABLE
AS $$
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
           l.environmental_setpoint, l.custom_fields, l.metadata,
           l.created_at, l.updated_at,
           CASE WHEN p_include_summary
                THEN (SELECT COUNT(*) FROM organization.locations c
                      WHERE c.parent_location_id = l.id
                        AND c.organization_id = p_organization_id)::BIGINT
                ELSE NULL END AS c_child_locations,
           NULL::BIGINT AS c_devices,
           NULL::BIGINT AS c_entities,
           NULL::BIGINT AS c_tags,
           NULL::BIGINT AS c_descendant_devices,
           NULL::BIGINT AS c_descendant_entities,
           NULL::BIGINT AS c_groups_referencing
    FROM organization.locations l
    WHERE l.id = p_id
      AND l.organization_id = p_organization_id
      AND (p_allowed_location_ids IS NULL OR l.id = ANY(p_allowed_location_ids));
$$;

-- RETURNS TABLE gains `metadata` — drop the prior v6 signature before recreate.
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

--------------DOWN
-- Revert by re-running 6101 + 6109. The four functions get dropped
-- because their RETURNS TABLE changed (added `metadata`).
DROP FUNCTION IF EXISTS organization.fn_location_list(
    VARCHAR, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER[],
    BOOLEAN, VARCHAR[], INTEGER[], INTEGER[]);
DROP FUNCTION IF EXISTS organization.fn_location_get(
    VARCHAR, INTEGER, BOOLEAN, INTEGER[], VARCHAR[], INTEGER[], INTEGER[]);
DROP FUNCTION IF EXISTS organization.fn_location_update(
    VARCHAR, INTEGER, VARCHAR, INTEGER, BOOLEAN, INTEGER, JSONB, JSONB);
DROP FUNCTION IF EXISTS organization.fn_location_create(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, JSONB, JSONB);
