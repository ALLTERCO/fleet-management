--------------UP
-- AlertEngine rule-cache loader. Returns every enabled rule in an org
-- with its destination-group ids pre-aggregated — one row per rule, no
-- N+1 join from app code.
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_list_enabled(
    p_organization_id VARCHAR
)
RETURNS TABLE (
    id                    INTEGER,
    organization_id       VARCHAR,
    name                  VARCHAR,
    kind                  VARCHAR,
    enabled               BOOLEAN,
    severity              VARCHAR,
    scope                 JSONB,
    dedupe_window_sec     INTEGER,
    cooldown_sec          INTEGER,
    owner_user_id         VARCHAR,
    summary_template      TEXT,
    message_template      TEXT,
    auto_resolve          BOOLEAN,
    config                JSONB,
    destination_group_ids INTEGER[],
    created_at            TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        r.id, r.organization_id, r.name, r.kind, r.enabled, r.severity,
        r.scope, r.dedupe_window_sec, r.cooldown_sec, r.owner_user_id,
        r.summary_template, r.message_template, r.auto_resolve, r.config,
        COALESCE(
            (SELECT array_agg(d.destination_group_id ORDER BY d.destination_group_id)
             FROM notifications.alert_rule_destination_groups d
             WHERE d.rule_id = r.id),
            ARRAY[]::INTEGER[]
        ) AS destination_group_ids,
        r.created_at, r.updated_at
    FROM notifications.alert_rules r
    WHERE r.organization_id = p_organization_id
      AND r.enabled = TRUE
    ORDER BY r.id ASC;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_rule_list_enabled;
