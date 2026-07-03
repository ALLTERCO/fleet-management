--------------UP
-- Extend fn_virtual_meta_set with optional measurement (IEC 61850) metadata.
-- The new parameter is appended so existing callers stay valid as long as
-- they bind by NAME — positional binds would need updating.

SET search_path TO device;

DROP FUNCTION IF EXISTS device.fn_virtual_meta_set(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, TIMESTAMPTZ, VARCHAR
);

CREATE OR REPLACE FUNCTION device.fn_virtual_meta_set(
    p_organization_id VARCHAR,
    p_host_shelly_id  VARCHAR,
    p_component_key   VARCHAR,
    p_glyph           VARCHAR     DEFAULT NULL,
    p_color           VARCHAR     DEFAULT NULL,
    p_gradient        JSONB       DEFAULT NULL,
    p_promoted_at     TIMESTAMPTZ DEFAULT NULL,
    p_image_path      VARCHAR     DEFAULT NULL,
    p_measurement     JSONB       DEFAULT NULL
)
RETURNS device.virtual_metadata
LANGUAGE plpgsql
AS $$
DECLARE
    v_row device.virtual_metadata;
BEGIN
    INSERT INTO device.virtual_metadata (
        organization_id, host_shelly_id, component_key,
        glyph, color, gradient, promoted_at, image_path, measurement
    )
    VALUES (
        p_organization_id, p_host_shelly_id, p_component_key,
        p_glyph, p_color, p_gradient, p_promoted_at, p_image_path, p_measurement
    )
    ON CONFLICT (organization_id, host_shelly_id, component_key) DO UPDATE
        SET glyph       = COALESCE(EXCLUDED.glyph,       device.virtual_metadata.glyph),
            color       = COALESCE(EXCLUDED.color,       device.virtual_metadata.color),
            gradient    = COALESCE(EXCLUDED.gradient,    device.virtual_metadata.gradient),
            promoted_at = COALESCE(EXCLUDED.promoted_at, device.virtual_metadata.promoted_at),
            image_path  = COALESCE(EXCLUDED.image_path,  device.virtual_metadata.image_path),
            measurement = COALESCE(EXCLUDED.measurement, device.virtual_metadata.measurement),
            updated     = CURRENT_TIMESTAMP
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

--------------DOWN
SET search_path TO device;

DROP FUNCTION IF EXISTS device.fn_virtual_meta_set(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, JSONB, TIMESTAMPTZ, VARCHAR, JSONB
);

CREATE OR REPLACE FUNCTION device.fn_virtual_meta_set(
    p_organization_id VARCHAR,
    p_host_shelly_id  VARCHAR,
    p_component_key   VARCHAR,
    p_glyph           VARCHAR     DEFAULT NULL,
    p_color           VARCHAR     DEFAULT NULL,
    p_gradient        JSONB       DEFAULT NULL,
    p_promoted_at     TIMESTAMPTZ DEFAULT NULL,
    p_image_path      VARCHAR     DEFAULT NULL
)
RETURNS device.virtual_metadata
LANGUAGE plpgsql
AS $$
DECLARE
    v_row device.virtual_metadata;
BEGIN
    INSERT INTO device.virtual_metadata (
        organization_id, host_shelly_id, component_key,
        glyph, color, gradient, promoted_at, image_path
    )
    VALUES (
        p_organization_id, p_host_shelly_id, p_component_key,
        p_glyph, p_color, p_gradient, p_promoted_at, p_image_path
    )
    ON CONFLICT (organization_id, host_shelly_id, component_key) DO UPDATE
        SET glyph       = COALESCE(EXCLUDED.glyph,       device.virtual_metadata.glyph),
            color       = COALESCE(EXCLUDED.color,       device.virtual_metadata.color),
            gradient    = COALESCE(EXCLUDED.gradient,    device.virtual_metadata.gradient),
            promoted_at = COALESCE(EXCLUDED.promoted_at, device.virtual_metadata.promoted_at),
            image_path  = COALESCE(EXCLUDED.image_path,  device.virtual_metadata.image_path),
            updated     = CURRENT_TIMESTAMP
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;
