--------------UP
-- Group activity timeline — returns audit_log rows for devices that
-- are members of the group (optionally including descendants in the
-- tree). Joins via both shelly_id and the GIN-indexed shelly_ids array
-- so bulk-op rows are included. The 64-depth cap mirrors
-- fn_group_descendants_count. total_count is repeated on every row so
-- callers use the standard list-response envelope.
CREATE OR REPLACE FUNCTION organization.fn_group_list_activity(
    p_organization_id     VARCHAR,
    p_group_id            INTEGER,
    p_from                TIMESTAMPTZ DEFAULT NULL,
    p_to                  TIMESTAMPTZ DEFAULT NULL,
    p_event_types         TEXT[]      DEFAULT NULL,
    p_include_descendants BOOLEAN     DEFAULT TRUE,
    p_limit               INTEGER     DEFAULT 200,
    p_offset              INTEGER     DEFAULT 0
)
RETURNS TABLE (
    audit_id       INTEGER,
    ts             TIMESTAMPTZ,
    event_type     VARCHAR,
    username       VARCHAR,
    shelly_id      VARCHAR,
    shelly_ids     TEXT[],
    method         VARCHAR,
    params         JSONB,
    success        BOOLEAN,
    error_message  TEXT,
    total_count    BIGINT
)
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT g.id, 1 AS depth
        FROM organization.groups g
        WHERE g.organization_id = p_organization_id
          AND g.id = p_group_id
        UNION ALL
        SELECT c.id, t.depth + 1
        FROM organization.groups c
        JOIN tree t ON c.parent_group_id = t.id
        WHERE c.organization_id = p_organization_id
          AND t.depth < 64
          AND p_include_descendants
    ),
    device_ids AS (
        SELECT DISTINCT gm.subject_id
        FROM organization.group_members gm
        WHERE gm.organization_id = p_organization_id
          AND gm.subject_type = 'device'
          AND gm.group_id IN (SELECT id FROM tree)
    ),
    ids_array AS (
        -- Cast to TEXT[] to match logging.audit_log.shelly_ids' element
        -- type; group_members.subject_id is VARCHAR, which breaks the
        -- array overlap operator without an explicit cast.
        SELECT ARRAY(SELECT subject_id::TEXT FROM device_ids) AS arr
    ),
    matched AS (
        SELECT
            a.id,
            a.ts,
            a.event_type,
            a.username,
            a.shelly_id,
            a.shelly_ids,
            a.method,
            a.params,
            a.success,
            a.error_message
        FROM logging.audit_log a, ids_array i
        WHERE (p_from IS NULL OR a.ts >= p_from)
          AND (p_to   IS NULL OR a.ts <= p_to)
          AND (p_event_types IS NULL OR a.event_type = ANY(p_event_types))
          AND cardinality(i.arr) > 0
          AND (a.shelly_id = ANY(i.arr) OR a.shelly_ids && i.arr)
    ),
    counted AS (
        SELECT COUNT(*)::BIGINT AS total_count FROM matched
    )
    SELECT
        m.id AS audit_id,
        m.ts,
        m.event_type,
        m.username,
        m.shelly_id,
        m.shelly_ids,
        m.method,
        m.params,
        m.success,
        m.error_message,
        c.total_count
    FROM matched m
    CROSS JOIN counted c
    ORDER BY m.ts DESC, m.id DESC
    LIMIT p_limit
    OFFSET p_offset;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_group_list_activity(
    VARCHAR, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], BOOLEAN, INTEGER, INTEGER
);
