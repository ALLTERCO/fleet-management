--------------UP
-- The function returns an `organization_id` column, so an unqualified name in
-- its UPDATE is ambiguous between that output variable and device.list.
ALTER FUNCTION organization.fn_location_configure_device_assignment(
    VARCHAR, INTEGER, VARCHAR, VARCHAR[], BOOLEAN, VARCHAR
)
    -- LINT-IGNORE: additive-only -- retained for the reversible replacement.
    RENAME TO fn_location_configure_device_assignment_v7367;

CREATE FUNCTION organization.fn_location_configure_device_assignment(
    p_organization_id      VARCHAR,
    p_location_id          INTEGER,
    p_shelly_id            VARCHAR,
    p_selected_entity_keys VARCHAR[],
    p_update_catalog_kind  BOOLEAN,
    p_catalog_kind         VARCHAR
)
RETURNS TABLE (
    organization_id VARCHAR,
    location_id INTEGER,
    shelly_id VARCHAR,
    selected_entity_keys VARCHAR[],
    catalog_kind VARCHAR,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_device_id INTEGER;
    v_entity_keys VARCHAR[];
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM organization.locations location_row
         WHERE location_row.organization_id = p_organization_id
           AND location_row.id = p_location_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id USING ERRCODE = '22023';
    END IF;

    SELECT device_row.id
      INTO v_device_id
      FROM device.list device_row
     WHERE device_row.organization_id = p_organization_id
       AND device_row.external_id = p_shelly_id
     FOR UPDATE;
    IF v_device_id IS NULL THEN
        RAISE EXCEPTION 'device % not found in organization %',
            p_shelly_id, p_organization_id USING ERRCODE = '22023';
    END IF;

    IF p_selected_entity_keys IS NOT NULL THEN
        SELECT COALESCE(
                   array_agg(DISTINCT btrim(entity_key) ORDER BY btrim(entity_key)),
                   ARRAY[]::VARCHAR[]
               )
          INTO v_entity_keys
          FROM unnest(p_selected_entity_keys) entity_key
         WHERE btrim(entity_key) <> '';
    END IF;

    IF p_update_catalog_kind THEN
        UPDATE device.list AS device_row
           SET catalog_kind = p_catalog_kind,
               updated = CURRENT_TIMESTAMP
         WHERE device_row.organization_id = p_organization_id
           AND device_row.id = v_device_id;
    END IF;

    RETURN QUERY
    WITH configured AS (
        INSERT INTO organization.location_assignments AS assignment (
            organization_id,
            subject_type,
            subject_id,
            device_id,
            entity_suffix,
            location_id,
            selected_entity_keys
        ) VALUES (
            p_organization_id,
            'device',
            NULL,
            v_device_id,
            NULL,
            p_location_id,
            v_entity_keys
        )
        ON CONFLICT ON CONSTRAINT location_assignment_pk
        DO UPDATE SET
            location_id = EXCLUDED.location_id,
            selected_entity_keys = EXCLUDED.selected_entity_keys,
            updated_at = CURRENT_TIMESTAMP
        RETURNING assignment.organization_id,
                  assignment.location_id,
                  assignment.device_id,
                  assignment.selected_entity_keys,
                  assignment.created_at,
                  assignment.updated_at
    )
    SELECT configured.organization_id,
           configured.location_id,
           device_row.external_id,
           configured.selected_entity_keys,
           device_row.catalog_kind::VARCHAR,
           configured.created_at,
           configured.updated_at
      FROM configured
      JOIN device.list device_row ON device_row.id = configured.device_id;
END;
$$;

--------------DOWN
-- LINT-IGNORE: additive-only -- restores the preceding function definition.
DROP FUNCTION IF EXISTS organization.fn_location_configure_device_assignment(
    VARCHAR, INTEGER, VARCHAR, VARCHAR[], BOOLEAN, VARCHAR
);
ALTER FUNCTION organization.fn_location_configure_device_assignment_v7367(
    VARCHAR, INTEGER, VARCHAR, VARCHAR[], BOOLEAN, VARCHAR
)
    -- LINT-IGNORE: additive-only
    RENAME TO fn_location_configure_device_assignment;
