--------------UP
-- Fix viz sub-field clear semantics. 6110 used jsonb_strip_nulls which made
-- it impossible to clear (e.g.) floorPlan once set — the caller's null was
-- stripped before reaching the merge.
--
-- New rule per the visualization plan: a sub-key the caller did not send
-- stays put; a sub-key the caller sent as null is removed; otherwise the
-- value replaces what's stored. Mirrors HTTP PATCH semantics.

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

    -- Per-sub-key PATCH: present-with-null erases, present-with-value
    -- replaces, absent leaves untouched. `?` checks key presence; `->`
    -- returns JSONB null for both null-value and missing — disambiguate
    -- via `->>` (returns SQL NULL only when value is JSON null).
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

--------------DOWN
-- Revert by re-running 6110 — its jsonb_strip_nulls behaviour is restored.
