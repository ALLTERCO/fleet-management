--------------UP
CREATE OR REPLACE FUNCTION organization.fn_location_placements_to_logical(
    p_organization_id VARCHAR,
    p_placements JSONB
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    WITH mapped AS (
        SELECT CASE
                   WHEN logical_device.id IS NOT NULL THEN placement.key
                   WHEN external_device.id IS NOT NULL
                       THEN external_device.id::TEXT
                   ELSE placement.key
               END AS target_key,
               placement.value,
               CASE WHEN logical_device.id IS NOT NULL THEN 1 ELSE 0 END
                   AS durable_priority
          FROM jsonb_each(COALESCE(p_placements, '{}'::jsonb)) placement
          LEFT JOIN device.list logical_device
            ON logical_device.organization_id = p_organization_id
           AND logical_device.id::TEXT = placement.key
          LEFT JOIN device.list external_device
            ON logical_device.id IS NULL
           AND external_device.organization_id = p_organization_id
           AND external_device.external_id = placement.key
    ), deduplicated AS (
        SELECT DISTINCT ON (target_key) target_key, value
          FROM mapped
         ORDER BY target_key, durable_priority DESC
    )
    SELECT COALESCE(jsonb_object_agg(target_key, value), '{}'::jsonb)
      FROM deduplicated;
$$;

WITH normalized AS (
    SELECT location.id,
           organization.fn_location_placements_to_logical(
               location.organization_id,
               location.metadata->'viz'->'devicePlacements'
           ) AS placements
      FROM organization.locations location
     WHERE jsonb_typeof(
         location.metadata->'viz'->'devicePlacements'
     ) = 'object'
)
UPDATE organization.locations location
   SET metadata = jsonb_set(
       location.metadata,
       '{viz,devicePlacements}',
       normalized.placements
   )
  FROM normalized
 WHERE location.id = normalized.id
   AND location.metadata->'viz'->'devicePlacements'
       IS DISTINCT FROM normalized.placements;

CREATE OR REPLACE FUNCTION organization.fn_location_apply_kind_fields(
    p_id INTEGER, p_kind_fields JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_viz JSONB;
    v_organization_id VARCHAR;
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

    SELECT organization_id, COALESCE(metadata->'viz', '{}'::jsonb)
      INTO v_organization_id, v_existing_viz
      FROM organization.locations
     WHERE id = p_id;

    IF p_kind_fields ? 'floorPlan' THEN
        IF p_kind_fields->>'floorPlan' IS NULL THEN
            v_existing_viz := v_existing_viz - 'floorPlan';
        ELSE
            v_existing_viz := jsonb_set(
                v_existing_viz, '{floorPlan}', p_kind_fields->'floorPlan'
            );
        END IF;
    END IF;

    IF p_kind_fields ? 'devicePlacements' THEN
        IF p_kind_fields->>'devicePlacements' IS NULL THEN
            v_existing_viz := v_existing_viz - 'devicePlacements';
        ELSE
            v_existing_viz := jsonb_set(
                v_existing_viz,
                '{devicePlacements}',
                organization.fn_location_placements_to_logical(
                    v_organization_id, p_kind_fields->'devicePlacements'
                )
            );
        END IF;
    END IF;

    IF p_kind_fields ? 'zones' THEN
        IF p_kind_fields->>'zones' IS NULL THEN
            v_existing_viz := v_existing_viz - 'zones';
        ELSE
            v_existing_viz := jsonb_set(
                v_existing_viz, '{zones}', p_kind_fields->'zones'
            );
        END IF;
    END IF;

    UPDATE organization.locations
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('viz', v_existing_viz)
     WHERE id = p_id;
END;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION organization.fn_location_placements_to_external(
    p_organization_id VARCHAR,
    p_placements JSONB
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        jsonb_object_agg(COALESCE(device.external_id, placement.key), placement.value),
        '{}'::jsonb
    )
      FROM jsonb_each(COALESCE(p_placements, '{}'::jsonb)) placement
      LEFT JOIN device.list device
        ON device.organization_id = p_organization_id
       AND device.id::TEXT = placement.key;
$$;

WITH projected AS (
    SELECT location.id,
           organization.fn_location_placements_to_external(
               location.organization_id,
               location.metadata->'viz'->'devicePlacements'
           ) AS placements
      FROM organization.locations location
     WHERE jsonb_typeof(
         location.metadata->'viz'->'devicePlacements'
     ) = 'object'
)
UPDATE organization.locations location
   SET metadata = jsonb_set(
       location.metadata,
       '{viz,devicePlacements}',
       projected.placements
   )
  FROM projected
 WHERE location.id = projected.id;

CREATE OR REPLACE FUNCTION organization.fn_location_apply_kind_fields(
    p_id INTEGER, p_kind_fields JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_viz JSONB;
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

    SELECT COALESCE(metadata->'viz', '{}'::jsonb) INTO v_existing_viz
      FROM organization.locations WHERE id = p_id;

    IF p_kind_fields ? 'floorPlan' THEN
        IF p_kind_fields->>'floorPlan' IS NULL THEN
            v_existing_viz := v_existing_viz - 'floorPlan';
        ELSE
            v_existing_viz := jsonb_set(
                v_existing_viz, '{floorPlan}', p_kind_fields->'floorPlan'
            );
        END IF;
    END IF;

    IF p_kind_fields ? 'devicePlacements' THEN
        IF p_kind_fields->>'devicePlacements' IS NULL THEN
            v_existing_viz := v_existing_viz - 'devicePlacements';
        ELSE
            v_existing_viz := jsonb_set(
                v_existing_viz, '{devicePlacements}',
                p_kind_fields->'devicePlacements'
            );
        END IF;
    END IF;

    IF p_kind_fields ? 'zones' THEN
        IF p_kind_fields->>'zones' IS NULL THEN
            v_existing_viz := v_existing_viz - 'zones';
        ELSE
            v_existing_viz := jsonb_set(
                v_existing_viz, '{zones}', p_kind_fields->'zones'
            );
        END IF;
    END IF;

    UPDATE organization.locations
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('viz', v_existing_viz)
     WHERE id = p_id;
END;
$$;

DROP FUNCTION IF EXISTS organization.fn_location_placements_to_external(
    VARCHAR, JSONB
);
DROP FUNCTION IF EXISTS organization.fn_location_placements_to_logical(
    VARCHAR, JSONB
);
