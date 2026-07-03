--------------UP
-- LEFT JOIN LATERAL (always-returns-total). Scope allowlist via p_allowed_ids.
CREATE OR REPLACE FUNCTION organization.fn_group_list(
    p_organization_id VARCHAR,
    p_parent_id       INTEGER   DEFAULT NULL,
    p_roots_only      BOOLEAN   DEFAULT FALSE,
    p_query           VARCHAR   DEFAULT NULL,
    p_group_type      VARCHAR   DEFAULT NULL,
    p_limit           INTEGER   DEFAULT 200,
    p_offset          INTEGER   DEFAULT 0,
    p_sort_by         VARCHAR   DEFAULT 'name',
    p_sort_dir        VARCHAR   DEFAULT 'asc',
    p_allowed_ids     INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count       BIGINT,
    id                INTEGER,
    organization_id   VARCHAR,
    name              VARCHAR,
    description       VARCHAR,
    parent_group_id   INTEGER,
    group_type        VARCHAR,
    membership_mode   VARCHAR,
    metadata          JSONB,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT g.*
        FROM organization.groups g
        WHERE g.organization_id = p_organization_id
          AND (
              (p_roots_only IS FALSE AND p_parent_id IS NULL)
              OR (p_roots_only IS TRUE  AND g.parent_group_id IS NULL)
              OR (p_roots_only IS FALSE AND g.parent_group_id = p_parent_id)
          )
          AND (p_group_type IS NULL OR g.group_type = p_group_type)
          AND (p_query IS NULL OR g.name ILIKE '%' || p_query || '%')
          AND (p_allowed_ids IS NULL OR g.id = ANY(p_allowed_ids))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.id, f.organization_id, f.name, f.description, f.parent_group_id,
        f.group_type, f.membership_mode, f.metadata, f.created_at, f.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY
            CASE WHEN p_sort_by = 'group_type' AND p_sort_dir = 'asc'  THEN group_type END ASC,
            CASE WHEN p_sort_by = 'group_type' AND p_sort_dir = 'desc' THEN group_type END DESC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN created_at END ASC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN created_at END DESC,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'asc'  THEN updated_at END ASC NULLS LAST,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'desc' THEN updated_at END DESC NULLS LAST,
            CASE WHEN (p_sort_by NOT IN ('group_type','created_at','updated_at') OR p_sort_by IS NULL)
                      AND p_sort_dir = 'desc' THEN name END DESC,
            name ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
--------------DOWN
DROP FUNCTION organization.fn_group_list;
