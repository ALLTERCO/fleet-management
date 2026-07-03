--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_destination_list(
    p_organization_id VARCHAR,
    p_enabled         BOOLEAN DEFAULT NULL,
    p_query           VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count         BIGINT,
    id                  INTEGER,
    organization_id     VARCHAR,
    name                VARCHAR,
    description         VARCHAR,
    enabled             BOOLEAN,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    c_members           BIGINT,
    c_rules_referencing BIGINT
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT *
        FROM notifications.destination_groups d
        WHERE d.organization_id = p_organization_id
          AND (p_enabled IS NULL OR d.enabled = p_enabled)
          AND (p_query IS NULL OR d.name ILIKE '%' || p_query || '%')
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        d.id, d.organization_id, d.name, d.description, d.enabled,
        d.created_at, d.updated_at,
        COALESCE(m.c_members, 0)::BIGINT AS c_members,
        COALESCE(r.c_rules_referencing, 0)::BIGINT AS c_rules_referencing
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY name ASC
        LIMIT p_limit OFFSET p_offset
    ) d ON TRUE
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS c_members
        FROM notifications.destination_group_members m
        WHERE m.destination_group_id = d.id
    ) m ON TRUE
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS c_rules_referencing
        FROM notifications.alert_rule_destination_groups r
        WHERE r.destination_group_id = d.id
    ) r ON TRUE;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_destination_list;
