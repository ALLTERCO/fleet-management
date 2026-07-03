--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_list_active_for_inhibition(
    p_organization_id VARCHAR,
    p_limit           INTEGER DEFAULT 500
)
RETURNS TABLE (
    id                  INTEGER,
    organization_id     VARCHAR,
    rule_id             INTEGER,
    rule_name           VARCHAR,
    rule_kind           VARCHAR,
    state               VARCHAR,
    severity            VARCHAR,
    source_subject_type VARCHAR,
    source_subject_id   VARCHAR,
    title               VARCHAR,
    message             TEXT,
    active_since        TIMESTAMPTZ,
    last_triggered_at   TIMESTAMPTZ,
    group_by            TEXT[]
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        ai.id,
        ai.organization_id,
        ai.rule_id,
        ar.name AS rule_name,
        ai.rule_kind,
        ai.state,
        ai.severity,
        ai.source_subject_type,
        ai.source_subject_id,
        ai.title,
        ai.message,
        ai.active_since,
        ai.last_triggered_at,
        ar.group_by
    FROM notifications.alert_instances ai
    JOIN notifications.alert_rules ar
      ON ar.id = ai.rule_id
     AND ar.organization_id = ai.organization_id
    WHERE ai.organization_id = p_organization_id
      AND ai.resolved_at IS NULL
      AND ai.state IN ('active', 'acknowledged')
    ORDER BY ai.last_triggered_at DESC, ai.id DESC
    LIMIT GREATEST(1, COALESCE(p_limit, 500));
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_list_active_for_inhibition(VARCHAR, INTEGER);
