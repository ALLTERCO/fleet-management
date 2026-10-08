--------------UP
-- Insert one library entry and return the stored row (component maps it
-- straight to the wire shape, no second fetch).

CREATE OR REPLACE FUNCTION fm.fn_ir_library_save(
    p_organization_id VARCHAR(120),
    p_name VARCHAR(128),
    p_brand VARCHAR(120),
    p_device_type VARCHAR(64),
    p_protocol VARCHAR(64),
    p_payload JSONB,
    p_source VARCHAR(16),
    p_source_detail VARCHAR(250),
    p_created_by VARCHAR(200)
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
    INSERT INTO fm.ir_library (
        organization_id, name, brand, device_type, protocol,
        payload, source, source_detail, created_by
    )
    VALUES (
        p_organization_id, p_name, p_brand, p_device_type, p_protocol,
        p_payload, p_source, p_source_detail, p_created_by
    )
    RETURNING id, organization_id, name, brand, device_type, protocol,
        payload, source, source_detail, created_by, created_at, updated_at;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_ir_library_save(
    VARCHAR(120), VARCHAR(128), VARCHAR(120), VARCHAR(64), VARCHAR(64),
    JSONB, VARCHAR(16), VARCHAR(250), VARCHAR(200)
);
