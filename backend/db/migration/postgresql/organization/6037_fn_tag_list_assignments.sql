--------------UP
-- LEFT JOIN LATERAL; always returns total.
CREATE OR REPLACE FUNCTION organization.fn_tag_list_assignments(
    p_organization_id VARCHAR,
    p_tag_id          INTEGER,
    p_subject_type    VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count  BIGINT,
    tag_id       INTEGER,
    subject_type VARCHAR,
    subject_id   VARCHAR,
    created_at   TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT ta.*
        FROM organization.tag_assignments ta
        WHERE ta.organization_id = p_organization_id
          AND ta.tag_id = p_tag_id
          AND (p_subject_type IS NULL OR ta.subject_type = p_subject_type)
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.tag_id, f.subject_type, f.subject_id, f.created_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY subject_type ASC, subject_id ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
--------------DOWN
DROP FUNCTION organization.fn_tag_list_assignments;
