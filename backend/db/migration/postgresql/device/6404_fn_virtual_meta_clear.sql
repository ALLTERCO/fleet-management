--------------UP
-- Per-field clear (demote = clear_promoted, drop color, etc).
CREATE OR REPLACE FUNCTION device.fn_virtual_meta_clear(
    p_organization_id VARCHAR,
    p_host_shelly_id VARCHAR,
    p_component_key VARCHAR,
    p_clear_glyph BOOLEAN DEFAULT FALSE,
    p_clear_color BOOLEAN DEFAULT FALSE,
    p_clear_gradient BOOLEAN DEFAULT FALSE,
    p_clear_promoted BOOLEAN DEFAULT FALSE,
    p_clear_image BOOLEAN DEFAULT FALSE
)
RETURNS device.virtual_metadata
LANGUAGE plpgsql
AS $$
DECLARE
    v_row device.virtual_metadata;
BEGIN
    UPDATE device.virtual_metadata
       SET glyph       = CASE WHEN p_clear_glyph    THEN NULL ELSE glyph       END,
           color       = CASE WHEN p_clear_color    THEN NULL ELSE color       END,
           gradient    = CASE WHEN p_clear_gradient THEN NULL ELSE gradient    END,
           promoted_at = CASE WHEN p_clear_promoted THEN NULL ELSE promoted_at END,
           image_path  = CASE WHEN p_clear_image    THEN NULL ELSE image_path  END,
           updated     = CURRENT_TIMESTAMP
     WHERE organization_id = p_organization_id
       AND host_shelly_id  = p_host_shelly_id
       AND component_key   = p_component_key
     RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_virtual_meta_clear(VARCHAR, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN);
