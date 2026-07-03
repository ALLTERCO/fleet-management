--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_update(
    p_organization_id        VARCHAR,
    p_id                     INTEGER,
    p_name                   VARCHAR DEFAULT NULL,
    p_enabled                BOOLEAN DEFAULT NULL,
    p_severity               VARCHAR DEFAULT NULL,
    p_scope                  JSONB DEFAULT NULL,
    p_dedupe_window_sec      INTEGER DEFAULT NULL,
    p_cooldown_sec           INTEGER DEFAULT NULL,
    p_owner_user_id          VARCHAR DEFAULT NULL,
    p_clear_owner_user_id    BOOLEAN DEFAULT FALSE,
    p_summary_template       TEXT DEFAULT NULL,
    p_clear_summary_template BOOLEAN DEFAULT FALSE,
    p_message_template       TEXT DEFAULT NULL,
    p_clear_message_template BOOLEAN DEFAULT FALSE,
    p_auto_resolve           BOOLEAN DEFAULT NULL,
    p_config                 JSONB DEFAULT NULL
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
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH updated AS (
        UPDATE notifications.alert_rules r
        SET
            name = COALESCE(p_name, r.name),
            enabled = COALESCE(p_enabled, r.enabled),
            severity = COALESCE(p_severity, r.severity),
            scope = COALESCE(p_scope, r.scope),
            dedupe_window_sec = COALESCE(p_dedupe_window_sec, r.dedupe_window_sec),
            cooldown_sec = COALESCE(p_cooldown_sec, r.cooldown_sec),
            owner_user_id = CASE
                WHEN p_clear_owner_user_id THEN NULL
                WHEN p_owner_user_id IS NOT NULL THEN p_owner_user_id
                ELSE r.owner_user_id
            END,
            summary_template = CASE
                WHEN p_clear_summary_template THEN NULL
                WHEN p_summary_template IS NOT NULL THEN p_summary_template
                ELSE r.summary_template
            END,
            message_template = CASE
                WHEN p_clear_message_template THEN NULL
                WHEN p_message_template IS NOT NULL THEN p_message_template
                ELSE r.message_template
            END,
            auto_resolve = COALESCE(p_auto_resolve, r.auto_resolve),
            config = COALESCE(p_config, r.config),
            updated_at = NOW()
        WHERE r.id = p_id
          AND r.organization_id = p_organization_id
        RETURNING r.*
    )
    SELECT
        u.id,
        u.organization_id,
        u.name,
        u.kind,
        u.enabled,
        u.severity,
        u.scope,
        u.dedupe_window_sec,
        u.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]) AS destination_group_ids,
        u.owner_user_id,
        u.summary_template,
        u.message_template,
        u.auto_resolve,
        u.config,
        u.created_at,
        u.updated_at
    FROM updated u
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g
        WHERE g.rule_id = u.id
    ) dest ON TRUE;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_rule_update;
