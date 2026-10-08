--------------UP
-- Windowed list with the standard COUNT(*) OVER () total; filters are
-- all optional (NULL = no filter). p_query searches name/brand/protocol.

CREATE OR REPLACE FUNCTION fm.fn_ir_library_list(
    p_organization_id VARCHAR(120),
    p_query VARCHAR(120),
    p_brand VARCHAR(120),
    p_device_type VARCHAR(64),
    p_source VARCHAR(16),
    p_limit INT,
    p_offset INT
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
    updated_at        TIMESTAMP WITH TIME ZONE,
    total_count       BIGINT
)
AS $$
    SELECT l.id, l.organization_id, l.name, l.brand, l.device_type,
        l.protocol, l.payload, l.source, l.source_detail, l.created_by,
        l.created_at, l.updated_at,
        COUNT(*) OVER () AS total_count
    FROM fm.ir_library AS l
    WHERE l.organization_id = p_organization_id
      AND (p_query IS NULL
           OR l.name ILIKE '%' || p_query || '%'
           OR l.brand ILIKE '%' || p_query || '%'
           OR l.protocol ILIKE '%' || p_query || '%')
      AND (p_brand IS NULL OR l.brand = p_brand)
      AND (p_device_type IS NULL OR l.device_type = p_device_type)
      AND (p_source IS NULL OR l.source = p_source)
    ORDER BY l.brand NULLS LAST, l.name, l.id
    LIMIT p_limit OFFSET p_offset;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_ir_library_list(
    VARCHAR(120), VARCHAR(120), VARCHAR(120), VARCHAR(64), VARCHAR(16),
    INT, INT
);
