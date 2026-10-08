--------------UP
-- Patch-style update: NULL param = keep current value; the p_clear_* flags
-- distinguish "clear to NULL" from "not provided" for the nullable columns.
-- Returns the updated row, or no row when the id is not in the org.

CREATE OR REPLACE FUNCTION fm.fn_ir_library_update(
    p_organization_id VARCHAR(120),
    p_id BIGINT,
    p_name VARCHAR(128),
    p_brand VARCHAR(120),
    p_clear_brand BOOLEAN,
    p_device_type VARCHAR(64),
    p_clear_device_type BOOLEAN,
    p_protocol VARCHAR(64),
    p_clear_protocol BOOLEAN,
    p_payload JSONB
)
RETURNS TABLE (
    id                BIGINT,
    organization_id   VARCHAR(120),
    name              VARCHAR(128),
    brand             VARCHAR(120),
    device_type       VARCHAR(64),
    protocol          VARCHAR(64),
    payload           JSONB,
    source            VARCHAR(16),
    source_detail     VARCHAR(250),
    created_by        VARCHAR(200),
    created_at        TIMESTAMP WITH TIME ZONE,
    updated_at        TIMESTAMP WITH TIME ZONE
)
AS $$
    UPDATE fm.ir_library AS l SET
        name = COALESCE(p_name, l.name),
        brand = CASE WHEN p_clear_brand THEN NULL
                     ELSE COALESCE(p_brand, l.brand) END,
        device_type = CASE WHEN p_clear_device_type THEN NULL
                           ELSE COALESCE(p_device_type, l.device_type) END,
        protocol = CASE WHEN p_clear_protocol THEN NULL
                        ELSE COALESCE(p_protocol, l.protocol) END,
        payload = COALESCE(p_payload, l.payload),
        updated_at = now()
    WHERE l.organization_id = p_organization_id AND l.id = p_id
    RETURNING l.id, l.organization_id, l.name, l.brand, l.device_type,
        l.protocol, l.payload, l.source, l.source_detail, l.created_by,
        l.created_at, l.updated_at;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_ir_library_update(
    VARCHAR(120), BIGINT, VARCHAR(128), VARCHAR(120), BOOLEAN,
    VARCHAR(64), BOOLEAN, VARCHAR(64), BOOLEAN, JSONB
);
