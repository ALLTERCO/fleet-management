--------------UP
-- Fetch a batch of entries by id, org-scoped. PushToDevice resolves its
-- entry ids in one round trip and detects missing ids from the result.

CREATE OR REPLACE FUNCTION fm.fn_ir_library_get_batch(
    p_organization_id VARCHAR(120),
    p_ids BIGINT[]
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
    SELECT l.id, l.organization_id, l.name, l.brand, l.device_type,
        l.protocol, l.payload, l.source, l.source_detail, l.created_by,
        l.created_at, l.updated_at
    FROM fm.ir_library AS l
    WHERE l.organization_id = p_organization_id AND l.id = ANY(p_ids)
    ORDER BY l.id;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_ir_library_get_batch(VARCHAR(120), BIGINT[]);
