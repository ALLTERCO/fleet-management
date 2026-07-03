--------------UP
-- Org-scope the alert-template read fns. 6532 added per-org templates but left
-- list/get global, leaking other orgs' template scope/config/message JSON.
-- Return only the caller's org templates plus NULL-org global seeds.
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_list(VARCHAR);
CREATE FUNCTION notifications.fn_alert_rule_template_list(
    p_organization_id VARCHAR,
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
        t.template_key, t.category, t.label, t.description, t.kind,
        t.severity, t.scope, t.config, t.dedupe_window_sec, t.cooldown_sec,
        t.summary_template, t.message_template, t.auto_resolve
    FROM notifications.alert_rule_templates t
    WHERE (p_category IS NULL OR t.category = p_category)
      AND (t.organization_id = p_organization_id
           OR t.organization_id IS NULL)
    ORDER BY t.category, t.template_key;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_get(VARCHAR);
CREATE FUNCTION notifications.fn_alert_rule_template_get(
    p_template_key VARCHAR,
    p_organization_id VARCHAR
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
        t.template_key, t.category, t.label, t.description, t.kind,
        t.severity, t.scope, t.config, t.dedupe_window_sec, t.cooldown_sec,
        t.summary_template, t.message_template, t.auto_resolve
    FROM notifications.alert_rule_templates t
    WHERE t.template_key = p_template_key
      AND (t.organization_id = p_organization_id
           OR t.organization_id IS NULL)
    -- Key can collide across (org, global) since 6532; prefer the org's own.
    ORDER BY (t.organization_id IS NOT NULL) DESC
    LIMIT 1;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_list(VARCHAR, VARCHAR);
CREATE FUNCTION notifications.fn_alert_rule_template_list(
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
        t.template_key, t.category, t.label, t.description, t.kind,
        t.severity, t.scope, t.config, t.dedupe_window_sec, t.cooldown_sec,
        t.summary_template, t.message_template, t.auto_resolve
    FROM notifications.alert_rule_templates t
    WHERE p_category IS NULL OR t.category = p_category
    ORDER BY t.category, t.template_key;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_get(VARCHAR, VARCHAR);
CREATE FUNCTION notifications.fn_alert_rule_template_get(
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
        t.template_key, t.category, t.label, t.description, t.kind,
        t.severity, t.scope, t.config, t.dedupe_window_sec, t.cooldown_sec,
        t.summary_template, t.message_template, t.auto_resolve
    FROM notifications.alert_rule_templates t
    WHERE t.template_key = p_template_key
    LIMIT 1;
$$;
