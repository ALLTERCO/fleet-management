--------------UP
-- Returns the full template catalog, optionally filtered by category.
-- Callers render these in the rule builder's "from template" picker.
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_list(
    p_category VARCHAR DEFAULT NULL
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
    WHERE p_category IS NULL OR t.category = p_category
    ORDER BY t.category, t.template_key;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_list(VARCHAR);
