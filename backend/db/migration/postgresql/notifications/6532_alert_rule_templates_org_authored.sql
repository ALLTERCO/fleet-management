--------------UP
-- Phase 5d: org-authored alert rule templates. NULL organization_id =
-- global (the original seed catalog); non-NULL = per-org template the
-- listed org can see and the author can edit.

ALTER TABLE notifications.alert_rule_templates
    ADD COLUMN IF NOT EXISTS organization_id VARCHAR(120) REFERENCES organization.profile(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS author_user_id  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ;

-- template_key was UNIQUE org-globally; relax to (organization_id, template_key)
-- so two orgs can both have 'walk-in-freezer' without colliding.
ALTER TABLE notifications.alert_rule_templates
    DROP CONSTRAINT IF EXISTS alert_rule_templates_template_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS alert_rule_templates_org_key_uniq
    ON notifications.alert_rule_templates (
        COALESCE(organization_id, ''), template_key
    );

CREATE INDEX IF NOT EXISTS alert_rule_templates_by_org_idx
    ON notifications.alert_rule_templates (organization_id, category, template_key);

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_create(
    p_organization_id   VARCHAR,
    p_template_key      VARCHAR,
    p_category          VARCHAR,
    p_label             VARCHAR,
    p_description       TEXT,
    p_kind              VARCHAR,
    p_severity          VARCHAR,
    p_scope             JSONB,
    p_config            JSONB,
    p_dedupe_window_sec INTEGER,
    p_cooldown_sec      INTEGER,
    p_summary_template  TEXT,
    p_message_template  TEXT,
    p_auto_resolve      BOOLEAN,
    p_author_user_id    VARCHAR
)
RETURNS TABLE (
    id                INTEGER,
    organization_id   VARCHAR,
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
    auto_resolve      BOOLEAN,
    author_user_id    VARCHAR,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    INSERT INTO notifications.alert_rule_templates (
        organization_id, template_key, category, label, description,
        kind, severity, scope, config, dedupe_window_sec, cooldown_sec,
        summary_template, message_template, auto_resolve, author_user_id
    )
    VALUES (
        p_organization_id, p_template_key, p_category, p_label, p_description,
        p_kind, p_severity, COALESCE(p_scope, '{}'::jsonb),
        COALESCE(p_config, '{}'::jsonb),
        COALESCE(p_dedupe_window_sec, 0), COALESCE(p_cooldown_sec, 0),
        p_summary_template, p_message_template,
        COALESCE(p_auto_resolve, TRUE), p_author_user_id
    )
    RETURNING
        id, organization_id, template_key, category, label, description,
        kind, severity, scope, config, dedupe_window_sec, cooldown_sec,
        summary_template, message_template, auto_resolve, author_user_id,
        created_at, updated_at;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_update(
    p_organization_id   VARCHAR,
    p_id                INTEGER,
    p_author_user_id    VARCHAR,
    p_label             VARCHAR,
    p_description       TEXT,
    p_severity          VARCHAR,
    p_scope             JSONB,
    p_config            JSONB,
    p_dedupe_window_sec INTEGER,
    p_cooldown_sec      INTEGER,
    p_summary_template  TEXT,
    p_message_template  TEXT,
    p_auto_resolve      BOOLEAN
)
RETURNS TABLE (
    id                INTEGER,
    organization_id   VARCHAR,
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
    auto_resolve      BOOLEAN,
    author_user_id    VARCHAR,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    UPDATE notifications.alert_rule_templates t
       SET label             = COALESCE(p_label, t.label),
           description       = COALESCE(p_description, t.description),
           severity          = COALESCE(p_severity, t.severity),
           scope             = COALESCE(p_scope, t.scope),
           config            = COALESCE(p_config, t.config),
           dedupe_window_sec = COALESCE(p_dedupe_window_sec, t.dedupe_window_sec),
           cooldown_sec      = COALESCE(p_cooldown_sec, t.cooldown_sec),
           summary_template  = COALESCE(p_summary_template, t.summary_template),
           message_template  = COALESCE(p_message_template, t.message_template),
           auto_resolve      = COALESCE(p_auto_resolve, t.auto_resolve),
           updated_at        = NOW()
     WHERE t.id = p_id
       AND t.organization_id = p_organization_id
       AND t.author_user_id  = p_author_user_id
    RETURNING
        t.id, t.organization_id, t.template_key, t.category, t.label, t.description,
        t.kind, t.severity, t.scope, t.config, t.dedupe_window_sec, t.cooldown_sec,
        t.summary_template, t.message_template, t.auto_resolve, t.author_user_id,
        t.created_at, t.updated_at;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_template_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_author_user_id  VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH deleted AS (
        DELETE FROM notifications.alert_rule_templates t
         WHERE t.id = p_id
           AND t.organization_id = p_organization_id
           AND t.author_user_id  = p_author_user_id
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM deleted);
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_delete(VARCHAR, INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_update(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB, JSONB,
    INTEGER, INTEGER, TEXT, TEXT, BOOLEAN
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_template_create(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB,
    JSONB, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, VARCHAR
);

DROP INDEX IF EXISTS notifications.alert_rule_templates_by_org_idx;
DROP INDEX IF EXISTS notifications.alert_rule_templates_org_key_uniq;

ALTER TABLE notifications.alert_rule_templates
    DROP COLUMN IF EXISTS updated_at;
ALTER TABLE notifications.alert_rule_templates
    DROP COLUMN IF EXISTS author_user_id;
ALTER TABLE notifications.alert_rule_templates
    DROP COLUMN IF EXISTS organization_id;
