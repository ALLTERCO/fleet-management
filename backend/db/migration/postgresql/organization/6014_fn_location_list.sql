--------------UP
-- p_parent_id: NULL = any, -1 = roots only, otherwise exact parent id.
CREATE OR REPLACE FUNCTION organization.fn_location_list(
    p_organization_id VARCHAR,
    p_parent_id       INTEGER DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    id                  INTEGER,
    organization_id     VARCHAR,
    name                VARCHAR,
    kind                VARCHAR,
    parent_location_id  INTEGER,
    sort_order          INTEGER,
    timezone            VARCHAR,
    address             JSONB,
    location_code       VARCHAR,
    geo                 JSONB,
    metadata            JSONB,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    total_count         BIGINT
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT *
        FROM organization.locations
        WHERE organization_id = p_organization_id
          AND (
              p_parent_id IS NULL
              OR (p_parent_id = -1 AND parent_location_id IS NULL)
              OR parent_location_id = p_parent_id
          )
    )
    SELECT id, organization_id, name, kind, parent_location_id, sort_order,
           timezone, address, location_code, geo, metadata, created_at, updated_at,
           (SELECT COUNT(*) FROM filtered) AS total_count
    FROM filtered
    ORDER BY sort_order ASC, name ASC
    LIMIT p_limit OFFSET p_offset;
$$;
--------------DOWN
DROP FUNCTION organization.fn_location_list;
