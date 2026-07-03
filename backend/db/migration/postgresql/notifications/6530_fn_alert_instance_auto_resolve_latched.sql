--------------UP
-- Latched semantics: safety-critical kinds (smoke, flood, gas) auto-clear
-- to 'cleared_unack' (still visible in inbox, resolved_at remains NULL
-- so a re-fire still re-uses the row). All other kinds keep the prior
-- 'resolved' terminal-on-clear behavior.

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_auto_resolve(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_fingerprint     VARCHAR
)
RETURNS TABLE (
    id                           INTEGER,
    organization_id              VARCHAR,
    rule_id                      INTEGER,
    rule_kind                    VARCHAR,
    state                        VARCHAR,
    severity                     VARCHAR,
    source_subject_type          VARCHAR,
    source_subject_id            VARCHAR,
    title                        VARCHAR,
    message                      TEXT,
    fingerprint                  VARCHAR,
    active_since                 TIMESTAMPTZ,
    last_triggered_at            TIMESTAMPTZ,
    acknowledged_at              TIMESTAMPTZ,
    acknowledged_by_user_id      VARCHAR,
    acknowledged_by_display_name VARCHAR,
    resolved_at                  TIMESTAMPTZ,
    silenced_until               TIMESTAMPTZ,
    silence_reason               TEXT,
    notifications_created_count  INTEGER,
    delivery_jobs_created_count  INTEGER,
    context                      JSONB
)
LANGUAGE sql
AS $$
    UPDATE notifications.alert_instances ai
    SET state = CASE
            WHEN ai.rule_kind IN ('smoke_alarm', 'flood_alarm')
                THEN 'cleared_unack'
            ELSE 'resolved'
        END,
        resolved_at = CASE
            WHEN ai.rule_kind IN ('smoke_alarm', 'flood_alarm')
                THEN ai.resolved_at  -- stay NULL, alert stays in inbox
            ELSE NOW()
        END
    WHERE ai.organization_id = p_organization_id
      AND ai.rule_id = p_rule_id
      AND ai.fingerprint = p_fingerprint
      AND ai.resolved_at IS NULL
    RETURNING
        ai.id, ai.organization_id, ai.rule_id, ai.rule_kind, ai.state,
        ai.severity, ai.source_subject_type, ai.source_subject_id,
        ai.title, ai.message, ai.fingerprint, ai.active_since,
        ai.last_triggered_at, ai.acknowledged_at,
        ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
        ai.resolved_at, ai.silenced_until, ai.silence_reason,
        ai.notifications_created_count, ai.delivery_jobs_created_count,
        ai.context;
$$;

--------------DOWN
-- Restore 6040 (always 'resolved' on auto-clear).
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_auto_resolve(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_fingerprint     VARCHAR
)
RETURNS TABLE (
    id                           INTEGER,
    organization_id              VARCHAR,
    rule_id                      INTEGER,
    rule_kind                    VARCHAR,
    state                        VARCHAR,
    severity                     VARCHAR,
    source_subject_type          VARCHAR,
    source_subject_id            VARCHAR,
    title                        VARCHAR,
    message                      TEXT,
    fingerprint                  VARCHAR,
    active_since                 TIMESTAMPTZ,
    last_triggered_at            TIMESTAMPTZ,
    acknowledged_at              TIMESTAMPTZ,
    acknowledged_by_user_id      VARCHAR,
    acknowledged_by_display_name VARCHAR,
    resolved_at                  TIMESTAMPTZ,
    silenced_until               TIMESTAMPTZ,
    silence_reason               TEXT,
    notifications_created_count  INTEGER,
    delivery_jobs_created_count  INTEGER,
    context                      JSONB
)
LANGUAGE sql
AS $$
    UPDATE notifications.alert_instances ai
    SET state       = 'resolved',
        resolved_at = NOW()
    WHERE ai.organization_id = p_organization_id
      AND ai.rule_id = p_rule_id
      AND ai.fingerprint = p_fingerprint
      AND ai.resolved_at IS NULL
    RETURNING
        ai.id, ai.organization_id, ai.rule_id, ai.rule_kind, ai.state,
        ai.severity, ai.source_subject_type, ai.source_subject_id,
        ai.title, ai.message, ai.fingerprint, ai.active_since,
        ai.last_triggered_at, ai.acknowledged_at,
        ai.acknowledged_by_user_id, ai.acknowledged_by_display_name,
        ai.resolved_at, ai.silenced_until, ai.silence_reason,
        ai.notifications_created_count, ai.delivery_jobs_created_count,
        ai.context;
$$;
