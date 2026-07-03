--------------UP
-- Pre-built alert rule catalog. Seeded below; callers instantiate via
-- fn_alert_rule_create_from_template which routes through fn_alert_rule_create
-- so the result is identical to a manually-created rule.
CREATE TABLE notifications.alert_rule_templates (
    id               SERIAL       PRIMARY KEY,
    template_key     VARCHAR(64)  NOT NULL UNIQUE,
    category         VARCHAR(32)  NOT NULL,
    label            VARCHAR(120) NOT NULL,
    description      TEXT,
    kind             VARCHAR(64)  NOT NULL,
    severity         VARCHAR(16)  NOT NULL,
    scope            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    config           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    dedupe_window_sec INTEGER     NOT NULL DEFAULT 0,
    cooldown_sec     INTEGER      NOT NULL DEFAULT 0,
    summary_template TEXT,
    message_template TEXT,
    auto_resolve     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT alert_rule_templates_severity_valid
        CHECK (severity IN ('info','warning','critical')),
    CONSTRAINT alert_rule_templates_dedupe_non_negative
        CHECK (dedupe_window_sec >= 0),
    CONSTRAINT alert_rule_templates_cooldown_non_negative
        CHECK (cooldown_sec >= 0)
);
CREATE INDEX alert_rule_templates_by_category
    ON notifications.alert_rule_templates (category, template_key);
--------------DOWN
DROP TABLE IF EXISTS notifications.alert_rule_templates;
