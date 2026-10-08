--------------UP
-- Tags and notes are accepted on save, so they must be stored; same PATCH rules as metadata.viz.

CREATE OR REPLACE FUNCTION organization.fn_location_apply_kind_fields(
    p_id INTEGER, p_kind_fields JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing_viz JSONB;
    v_existing_details JSONB;
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

    SELECT organization_id, COALESCE(metadata->'viz', '{}'::jsonb),
           COALESCE(metadata->'locationDetails', '{}'::jsonb)
      INTO v_organization_id, v_existing_viz, v_existing_details
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

    IF p_kind_fields ? 'tags' THEN
        IF p_kind_fields->>'tags' IS NULL THEN
            v_existing_details := v_existing_details - 'tags';
        ELSE
            v_existing_details := jsonb_set(
                v_existing_details, '{tags}', p_kind_fields->'tags'
            );
        END IF;
    END IF;

    IF p_kind_fields ? 'notes' THEN
        IF p_kind_fields->>'notes' IS NULL THEN
            v_existing_details := v_existing_details - 'notes';
        ELSE
            v_existing_details := jsonb_set(
                v_existing_details, '{notes}', p_kind_fields->'notes'
            );
        END IF;
    END IF;

    UPDATE organization.locations
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('viz', v_existing_viz)
                      || jsonb_build_object('locationDetails', v_existing_details)
     WHERE id = p_id;
END;
$$;

--------------DOWN
-- Restore the 7321 function body (no tags/notes handling).
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
