--------------UP
-- Entity selection belongs to the device/location assignment, not template JSON.
ALTER TABLE organization.location_assignments
    ADD COLUMN IF NOT EXISTS selected_entity_keys VARCHAR(255)[];

ALTER TABLE organization.location_assignments
    DROP CONSTRAINT IF EXISTS location_assignment_entity_selection_valid;
ALTER TABLE organization.location_assignments
    ADD CONSTRAINT location_assignment_entity_selection_valid CHECK (
        selected_entity_keys IS NULL OR subject_type = 'device'
    );

CREATE OR REPLACE FUNCTION organization.fn_location_configure_device_assignment(
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
        SELECT 1 FROM organization.locations l
         WHERE l.organization_id = p_organization_id
           AND l.id = p_location_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id USING ERRCODE = '22023';
    END IF;

    SELECT dl.id
      INTO v_device_id
      FROM device.list dl
     WHERE dl.organization_id = p_organization_id
       AND dl.external_id = p_shelly_id
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
        UPDATE device.list
           SET catalog_kind = p_catalog_kind,
               updated = CURRENT_TIMESTAMP
         WHERE organization_id = p_organization_id
           AND id = v_device_id;
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
           dl.external_id,
           configured.selected_entity_keys,
           dl.catalog_kind,
           configured.created_at,
           configured.updated_at
      FROM configured
      JOIN device.list dl ON dl.id = configured.device_id;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_list_device_assignment_profiles(
    p_organization_id VARCHAR,
    p_location_ids    INTEGER[],
    p_shelly_ids      VARCHAR[],
    p_limit           INTEGER,
    p_offset          INTEGER,
    p_allowed_ids     INTEGER[]
)
RETURNS TABLE (
    organization_id VARCHAR,
    location_id INTEGER,
    shelly_id VARCHAR,
    selected_entity_keys VARCHAR[],
    catalog_kind VARCHAR,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    total_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
    SELECT assignment.organization_id,
           assignment.location_id,
           dl.external_id,
           assignment.selected_entity_keys,
           dl.catalog_kind,
           assignment.created_at,
           assignment.updated_at,
           count(*) OVER () AS total_count
      FROM organization.location_assignments assignment
      JOIN device.list dl
        ON dl.organization_id = assignment.organization_id
       AND dl.id = assignment.device_id
     WHERE assignment.organization_id = p_organization_id
       AND assignment.subject_type = 'device'
       AND (p_location_ids IS NULL OR assignment.location_id = ANY(p_location_ids))
       AND (p_shelly_ids IS NULL OR dl.external_id = ANY(p_shelly_ids))
       AND (p_allowed_ids IS NULL OR assignment.location_id = ANY(p_allowed_ids))
     ORDER BY assignment.location_id, dl.external_id
     LIMIT p_limit OFFSET p_offset;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_list_device_assignment_profiles(
    VARCHAR, INTEGER[], VARCHAR[], INTEGER, INTEGER, INTEGER[]
);
DROP FUNCTION IF EXISTS organization.fn_location_configure_device_assignment(
    VARCHAR, INTEGER, VARCHAR, VARCHAR[], BOOLEAN, VARCHAR
);
ALTER TABLE organization.location_assignments
    DROP CONSTRAINT IF EXISTS location_assignment_entity_selection_valid;
ALTER TABLE organization.location_assignments
    DROP COLUMN IF EXISTS selected_entity_keys;
