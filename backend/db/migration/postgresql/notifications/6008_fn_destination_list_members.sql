--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_destination_list_members(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count BIGINT,
    member_type VARCHAR,
    member_id   VARCHAR
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT m.member_type, m.member_id
        FROM notifications.destination_group_members m
        JOIN notifications.destination_groups d
          ON d.id = m.destination_group_id
        WHERE d.organization_id = p_organization_id
          AND d.id = p_id
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.member_type,
        f.member_id
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY member_type ASC, member_id ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_destination_list_members;
