--------------UP
-- p_include_summary: counts JSONB = {subject_type: n}; '{}' when no rows.
-- Per-bucket allowlist filters scope visible counts to caller's access.
DROP FUNCTION IF EXISTS organization.fn_tag_list(VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR, VARCHAR);
CREATE OR REPLACE FUNCTION organization.fn_tag_list(
    p_organization_id       VARCHAR,
    p_query                 VARCHAR   DEFAULT NULL,
    p_key                   VARCHAR   DEFAULT NULL,
    p_limit                 INTEGER   DEFAULT 200,
    p_offset                INTEGER   DEFAULT 0,
    p_sort_by               VARCHAR   DEFAULT 'key',
    p_sort_dir              VARCHAR   DEFAULT 'asc',
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids     INTEGER[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL
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
    updated_at      TIMESTAMPTZ,
    counts          JSONB
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
        f.icon, f.metadata, f.created_at, f.updated_at,
        CASE WHEN p_include_summary THEN
            COALESCE(
                (SELECT jsonb_object_agg(subject_type, c)
                 FROM (
                     SELECT ta.subject_type, COUNT(*) AS c
                     FROM organization.tag_assignments ta
                     WHERE ta.tag_id = f.id
                       AND ta.organization_id = p_organization_id
                       AND (
                           ta.subject_type NOT IN ('device','entity','group','location')
                           OR (ta.subject_type = 'device'
                               AND (p_allowed_device_ids IS NULL
                                    OR ta.subject_id = ANY(p_allowed_device_ids)))
                           OR (ta.subject_type = 'entity'
                               AND organization.fn_entity_belongs_to_device(ta.subject_id, p_allowed_device_ids))
                           OR (ta.subject_type = 'group'
                               AND (p_allowed_group_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_group_ids) AS x(id)
                                    )))
                           OR (ta.subject_type = 'location'
                               AND (p_allowed_location_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_location_ids) AS x(id)
                                    )))
                       )
                     GROUP BY ta.subject_type
                 ) agg),
                '{}'::jsonb
            )
        END
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
DROP FUNCTION IF EXISTS organization.fn_tag_list(VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR, VARCHAR, BOOLEAN, VARCHAR[], INTEGER[], INTEGER[]);
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
        ORDER BY key ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
