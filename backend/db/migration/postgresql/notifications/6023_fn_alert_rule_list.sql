--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_list(
    p_organization_id VARCHAR,
    p_enabled         BOOLEAN DEFAULT NULL,
    p_kind            VARCHAR DEFAULT NULL,
    p_query           VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count            BIGINT,
    id                     INTEGER,
    organization_id        VARCHAR,
    name                   VARCHAR,
    kind                   VARCHAR,
    enabled                BOOLEAN,
    severity               VARCHAR,
    scope                  JSONB,
    dedupe_window_sec      INTEGER,
    cooldown_sec           INTEGER,
    destination_group_ids  INTEGER[],
    owner_user_id          VARCHAR,
    summary_template       TEXT,
    message_template       TEXT,
    auto_resolve           BOOLEAN,
    config                 JSONB,
    created_at             TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT *
        FROM notifications.alert_rules r
        WHERE r.organization_id = p_organization_id
          AND (p_enabled IS NULL OR r.enabled = p_enabled)
          AND (p_kind IS NULL OR r.kind = p_kind)
          AND (p_query IS NULL OR r.name ILIKE '%' || p_query || '%')
    ),
    total AS (
        SELECT COUNT(*) AS c
        FROM filtered
    )
    SELECT
        total.c AS total_count,
        r.id,
        r.organization_id,
        r.name,
        r.kind,
        r.enabled,
        r.severity,
        r.scope,
        r.dedupe_window_sec,
        r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]) AS destination_group_ids,
        r.owner_user_id,
        r.summary_template,
        r.message_template,
        r.auto_resolve,
        r.config,
        r.created_at,
        r.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY name ASC
        LIMIT p_limit OFFSET p_offset
    ) r ON TRUE
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g
        WHERE g.rule_id = r.id
    ) dest ON TRUE;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_rule_list;
