--------------UP
ALTER TABLE device.virtual_metadata
    ADD COLUMN IF NOT EXISTS host_device_id INT;

UPDATE device.virtual_metadata m
   SET host_device_id = d.id
  FROM device.list d
 WHERE m.host_device_id IS NULL
   AND d.organization_id = m.organization_id
   AND d.external_id = m.host_shelly_id;

ALTER TABLE device.virtual_metadata
    ALTER COLUMN host_device_id SET NOT NULL,
    ADD CONSTRAINT virtual_metadata_host_device_fk
        FOREIGN KEY (host_device_id, organization_id)
        REFERENCES device.list(id, organization_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS virtual_metadata_logical_component_idx
    ON device.virtual_metadata (
        organization_id, host_device_id, component_key
    );

CREATE OR REPLACE FUNCTION device.fn_virtual_meta_set(
    p_organization_id VARCHAR,
    p_host_shelly_id VARCHAR,
    p_component_key VARCHAR,
    p_glyph VARCHAR DEFAULT NULL,
    p_color VARCHAR DEFAULT NULL,
    p_gradient JSONB DEFAULT NULL,
    p_promoted_at TIMESTAMPTZ DEFAULT NULL,
    p_image_path UUID DEFAULT NULL,
    p_measurement JSONB DEFAULT NULL
)
RETURNS device.virtual_metadata
LANGUAGE plpgsql
AS $$
DECLARE
    v_host_device_id INT;
    v_row device.virtual_metadata;
BEGIN
    SELECT id INTO v_host_device_id
      FROM device.list
     WHERE organization_id = p_organization_id
       AND external_id = p_host_shelly_id;
    IF v_host_device_id IS NULL THEN
        RAISE EXCEPTION 'device % not found in organization %',
            p_host_shelly_id, p_organization_id;
    END IF;

    INSERT INTO device.virtual_metadata (
        organization_id, host_device_id, host_shelly_id, component_key,
        glyph, color, gradient, promoted_at, image_path, measurement
    ) VALUES (
        p_organization_id, v_host_device_id, p_host_shelly_id, p_component_key,
        p_glyph, p_color, p_gradient, p_promoted_at, p_image_path, p_measurement
    )
    ON CONFLICT (organization_id, host_device_id, component_key) DO UPDATE
        SET host_shelly_id = EXCLUDED.host_shelly_id,
            glyph = COALESCE(EXCLUDED.glyph, device.virtual_metadata.glyph),
            color = COALESCE(EXCLUDED.color, device.virtual_metadata.color),
            gradient = COALESCE(
                EXCLUDED.gradient, device.virtual_metadata.gradient
            ),
            promoted_at = COALESCE(
                EXCLUDED.promoted_at, device.virtual_metadata.promoted_at
            ),
            image_path = COALESCE(
                EXCLUDED.image_path, device.virtual_metadata.image_path
            ),
            measurement = COALESCE(
                EXCLUDED.measurement, device.virtual_metadata.measurement
            ),
            updated = CURRENT_TIMESTAMP
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION device.fn_virtual_meta_clear(
    p_organization_id VARCHAR,
    p_host_shelly_id VARCHAR,
    p_component_key VARCHAR,
    p_clear_glyph BOOLEAN DEFAULT FALSE,
    p_clear_color BOOLEAN DEFAULT FALSE,
    p_clear_gradient BOOLEAN DEFAULT FALSE,
    p_clear_promoted BOOLEAN DEFAULT FALSE,
    p_clear_image BOOLEAN DEFAULT FALSE,
    p_clear_measurement BOOLEAN DEFAULT FALSE
)
RETURNS device.virtual_metadata
LANGUAGE plpgsql
AS $$
DECLARE
    v_row device.virtual_metadata;
BEGIN
    UPDATE device.virtual_metadata m
       SET glyph = CASE WHEN p_clear_glyph THEN NULL ELSE glyph END,
           color = CASE WHEN p_clear_color THEN NULL ELSE color END,
           gradient = CASE WHEN p_clear_gradient THEN NULL ELSE gradient END,
           promoted_at = CASE
               WHEN p_clear_promoted THEN NULL ELSE promoted_at
           END,
           image_path = CASE WHEN p_clear_image THEN NULL ELSE image_path END,
           measurement = CASE
               WHEN p_clear_measurement THEN NULL ELSE measurement
           END,
           updated = CURRENT_TIMESTAMP
     WHERE m.organization_id = p_organization_id
       AND m.host_device_id = (
           SELECT d.id FROM device.list d
            WHERE d.organization_id = p_organization_id
              AND d.external_id = p_host_shelly_id
       )
       AND m.component_key = p_component_key
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION device.fn_virtual_meta_delete(
    p_organization_id VARCHAR,
    p_host_shelly_id VARCHAR,
    p_component_key VARCHAR
)
RETURNS VOID
LANGUAGE sql
AS $$
    DELETE FROM device.virtual_metadata m
     WHERE m.organization_id = p_organization_id
       AND m.host_device_id = (
           SELECT d.id FROM device.list d
            WHERE d.organization_id = p_organization_id
              AND d.external_id = p_host_shelly_id
       )
       AND m.component_key = p_component_key;
$$;

CREATE OR REPLACE FUNCTION device.fn_virtual_meta_fetch(
    p_organization_id VARCHAR,
    p_host_shelly_id VARCHAR
)
RETURNS SETOF device.virtual_metadata
LANGUAGE sql
STABLE
AS $$
    SELECT m.*
      FROM device.virtual_metadata m
      JOIN device.list d
        ON d.id = m.host_device_id
       AND d.organization_id = m.organization_id
     WHERE m.organization_id = p_organization_id
       AND d.external_id = p_host_shelly_id;
$$;

CREATE OR REPLACE FUNCTION device.fn_reassign_virtual_metadata_ownership(
    p_organization_id VARCHAR,
    p_retained_device_id INT,
    p_temporary_device_id INT,
    p_new_external_id VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    WITH moved AS (
        DELETE FROM device.virtual_metadata
         WHERE organization_id = p_organization_id
           AND host_device_id = p_temporary_device_id
        RETURNING *
    )
    INSERT INTO device.virtual_metadata (
        organization_id, host_device_id, host_shelly_id, component_key,
        glyph, color, gradient, promoted_at, image_path, measurement,
        created, updated
    )
    SELECT p_organization_id, p_retained_device_id, p_new_external_id,
           component_key, glyph, color, gradient, promoted_at, image_path,
           measurement, created, updated
      FROM moved
    ON CONFLICT (organization_id, host_device_id, component_key) DO UPDATE
        SET host_shelly_id = EXCLUDED.host_shelly_id,
            glyph = COALESCE(EXCLUDED.glyph, device.virtual_metadata.glyph),
            color = COALESCE(EXCLUDED.color, device.virtual_metadata.color),
            gradient = COALESCE(
                EXCLUDED.gradient, device.virtual_metadata.gradient
            ),
            promoted_at = COALESCE(
                EXCLUDED.promoted_at, device.virtual_metadata.promoted_at
            ),
            image_path = COALESCE(
                EXCLUDED.image_path, device.virtual_metadata.image_path
            ),
            measurement = COALESCE(
                EXCLUDED.measurement, device.virtual_metadata.measurement
            ),
            updated = GREATEST(
                EXCLUDED.updated, device.virtual_metadata.updated
            );

    UPDATE device.virtual_metadata
       SET host_shelly_id = p_new_external_id,
           updated = CURRENT_TIMESTAMP
     WHERE organization_id = p_organization_id
       AND host_device_id = p_retained_device_id;
END;
$$;

--------------DOWN
-- Forward-only logical identity migration.
