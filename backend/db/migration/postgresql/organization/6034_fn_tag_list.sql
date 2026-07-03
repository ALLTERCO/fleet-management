--------------UP
-- LEFT JOIN LATERAL pattern; always returns total even on empty page.
-- p_sort_by: 'key' | 'name' | 'created_at' | 'updated_at' (default 'key').
-- p_sort_dir: 'asc' | 'desc' (default 'asc').
CREATE OR REPLACE FUNCTION organization.fn_tag_list(
    p_organization_id VARCHAR,
    p_query           VARCHAR DEFAULT NULL,
    p_key             VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0,
    p_sort_by         VARCHAR DEFAULT 'key',
    p_sort_dir        VARCHAR DEFAULT 'asc'
)
RETURNS TABLE (
    total_count     BIGINT,
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT t.*
        FROM organization.tags t
        WHERE t.organization_id = p_organization_id
          AND (p_key IS NULL OR t.key = LOWER(p_key))
          AND (p_query IS NULL OR (
              t.name ILIKE '%' || p_query || '%'
              OR t.key  ILIKE '%' || p_query || '%'
          ))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.id, f.organization_id, f.key, f.name, f.description, f.color,
        f.icon, f.metadata, f.created_at, f.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'asc'  THEN name       END ASC,
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'desc' THEN name       END DESC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN created_at END ASC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN created_at END DESC,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'asc'  THEN updated_at END ASC NULLS LAST,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'desc' THEN updated_at END DESC NULLS LAST,
            CASE WHEN (p_sort_by NOT IN ('name','created_at','updated_at') OR p_sort_by IS NULL)
                      AND p_sort_dir = 'desc' THEN key END DESC,
            key ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
--------------DOWN
DROP FUNCTION organization.fn_tag_list;
