--------------UP
-- Bulk insert for file imports: one round trip for the whole parsed file.
-- p_entries is a JSONB array of {name, brand, deviceType, protocol,
-- payload} objects (validated by the component before the call); the
-- shared source/sourceDetail/createdBy apply to every row.

CREATE OR REPLACE FUNCTION fm.fn_ir_library_import_batch(
    p_organization_id VARCHAR(120),
    p_entries JSONB,
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
    SELECT p_organization_id,
        e->>'name',
        e->>'brand',
        e->>'deviceType',
        e->>'protocol',
        COALESCE(e->'payload', '{}'::jsonb),
        p_source, p_source_detail, p_created_by
    FROM jsonb_array_elements(p_entries) AS e
    RETURNING id, organization_id, name, brand, device_type, protocol,
        payload, source, source_detail, created_by, created_at, updated_at;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_ir_library_import_batch(
    VARCHAR(120), JSONB, VARCHAR(16), VARCHAR(250), VARCHAR(200)
);
