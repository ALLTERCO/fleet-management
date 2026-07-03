--------------UP
CREATE OR REPLACE FUNCTION organization.fn_group_list_members(
    p_organization_id VARCHAR,
    p_group_id        INTEGER,
    p_subject_type    VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count  BIGINT,
    group_id     INTEGER,
    subject_type VARCHAR,
    subject_id   VARCHAR,
    created_at   TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT gm.*
        FROM organization.group_members gm
        WHERE gm.organization_id = p_organization_id
          AND gm.group_id = p_group_id
          AND (p_subject_type IS NULL OR gm.subject_type = p_subject_type)
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.group_id, f.subject_type, f.subject_id, f.created_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY subject_type ASC, subject_id ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
--------------DOWN
DROP FUNCTION organization.fn_group_list_members;
