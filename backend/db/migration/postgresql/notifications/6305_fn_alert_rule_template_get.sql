--------------UP
-- Fetch one template by its stable key. Used by CreateFromTemplate to
-- resolve defaults before routing through fn_alert_rule_create.
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_get(
    p_template_key VARCHAR
)
RETURNS TABLE (
    template_key      VARCHAR,
    category          VARCHAR,
    label             VARCHAR,
    description       TEXT,
    kind              VARCHAR,
    severity          VARCHAR,
    scope             JSONB,
    config            JSONB,
    dedupe_window_sec INTEGER,
    cooldown_sec      INTEGER,
    summary_template  TEXT,
    message_template  TEXT,
    auto_resolve      BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        t.template_key,
        t.category,
        t.label,
        t.description,
        t.kind,
        t.severity,
        t.scope,
        t.config,
        t.dedupe_window_sec,
        t.cooldown_sec,
        t.summary_template,
        t.message_template,
        t.auto_resolve
    FROM notifications.alert_rule_templates t
    WHERE t.template_key = p_template_key
    LIMIT 1;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_get(VARCHAR);
