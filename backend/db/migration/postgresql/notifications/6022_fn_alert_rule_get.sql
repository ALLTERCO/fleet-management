--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
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
    SELECT
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
    FROM notifications.alert_rules r
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g
        WHERE g.rule_id = r.id
    ) dest ON TRUE
    WHERE r.organization_id = p_organization_id
      AND r.id = p_id;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_rule_get;
