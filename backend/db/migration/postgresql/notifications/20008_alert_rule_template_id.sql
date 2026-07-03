--------------UP
-- Link a rule to a reusable multi-channel message template. NULL = use the
-- rule's own summary/message wording (today's behavior). ON DELETE SET NULL so
-- deleting a template silently reverts its rules to inline wording.
ALTER TABLE notifications.alert_rules
    ADD COLUMN IF NOT EXISTS template_id INTEGER
        REFERENCES notifications.message_template(id) ON DELETE SET NULL;

-- create: accept + store p_template_id (result is re-fetched via fn_alert_rule_get).
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_create(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, BOOLEAN, JSONB, INTEGER, INTEGER,
    VARCHAR, TEXT, TEXT, BOOLEAN, JSONB, TEXT[], VARCHAR, INTEGER, VARCHAR
);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_create(
    p_organization_id        VARCHAR,
    p_name                   VARCHAR,
    p_kind                   VARCHAR,
    p_severity               VARCHAR,
    p_enabled                BOOLEAN DEFAULT TRUE,
    p_scope                  JSONB DEFAULT '{}'::jsonb,
    p_dedupe_window_sec      INTEGER DEFAULT 0,
    p_cooldown_sec           INTEGER DEFAULT 0,
    p_owner_user_id          VARCHAR DEFAULT NULL,
    p_summary_template       TEXT DEFAULT NULL,
    p_message_template       TEXT DEFAULT NULL,
    p_auto_resolve           BOOLEAN DEFAULT TRUE,
    p_config                 JSONB DEFAULT '{}'::jsonb,
    p_group_by               TEXT[] DEFAULT NULL,
    p_delivery_mode          VARCHAR DEFAULT 'instant',
    p_digest_window_minutes  INTEGER DEFAULT NULL,
    p_runbook_url            VARCHAR DEFAULT NULL,
    p_template_id            INTEGER DEFAULT NULL
)
RETURNS TABLE (id INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    RETURN QUERY
    INSERT INTO notifications.alert_rules (
        organization_id, name, kind, enabled, severity, scope,
        dedupe_window_sec, cooldown_sec, owner_user_id,
        summary_template, message_template, auto_resolve, config,
        group_by, delivery_mode, digest_window_minutes, runbook_url, template_id
    )
    VALUES (
        p_organization_id, p_name, p_kind, COALESCE(p_enabled, TRUE),
        p_severity, COALESCE(p_scope, '{}'::jsonb),
        COALESCE(p_dedupe_window_sec, 0), COALESCE(p_cooldown_sec, 0),
        p_owner_user_id, p_summary_template, p_message_template,
        COALESCE(p_auto_resolve, TRUE), COALESCE(p_config, '{}'::jsonb),
        p_group_by, COALESCE(p_delivery_mode, 'instant'),
        p_digest_window_minutes, p_runbook_url, p_template_id
    )
    RETURNING alert_rules.id;
END;
$$;

-- update: add p_template_id + p_clear_template_id.
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_update(
    VARCHAR, INTEGER, VARCHAR, BOOLEAN, VARCHAR, JSONB, INTEGER, INTEGER,
    VARCHAR, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, BOOLEAN, JSONB,
    TEXT[], BOOLEAN, VARCHAR, INTEGER, BOOLEAN, VARCHAR, BOOLEAN
);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_update(
    p_organization_id           VARCHAR,
    p_id                        INTEGER,
    p_name                      VARCHAR DEFAULT NULL,
    p_enabled                   BOOLEAN DEFAULT NULL,
    p_severity                  VARCHAR DEFAULT NULL,
    p_scope                     JSONB DEFAULT NULL,
    p_dedupe_window_sec         INTEGER DEFAULT NULL,
    p_cooldown_sec              INTEGER DEFAULT NULL,
    p_owner_user_id             VARCHAR DEFAULT NULL,
    p_clear_owner_user_id       BOOLEAN DEFAULT FALSE,
    p_summary_template          TEXT DEFAULT NULL,
    p_clear_summary_template    BOOLEAN DEFAULT FALSE,
    p_message_template          TEXT DEFAULT NULL,
    p_clear_message_template    BOOLEAN DEFAULT FALSE,
    p_auto_resolve              BOOLEAN DEFAULT NULL,
    p_config                    JSONB DEFAULT NULL,
    p_group_by                  TEXT[] DEFAULT NULL,
    p_clear_group_by            BOOLEAN DEFAULT FALSE,
    p_delivery_mode             VARCHAR DEFAULT NULL,
    p_digest_window_minutes     INTEGER DEFAULT NULL,
    p_clear_digest_window       BOOLEAN DEFAULT FALSE,
    p_runbook_url               VARCHAR DEFAULT NULL,
    p_clear_runbook_url         BOOLEAN DEFAULT FALSE,
    p_template_id               INTEGER DEFAULT NULL,
    p_clear_template_id         BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (id INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE notifications.alert_rules r
    SET
        name = COALESCE(p_name, r.name),
        enabled = COALESCE(p_enabled, r.enabled),
        severity = COALESCE(p_severity, r.severity),
        scope = COALESCE(p_scope, r.scope),
        dedupe_window_sec = COALESCE(p_dedupe_window_sec, r.dedupe_window_sec),
        cooldown_sec = COALESCE(p_cooldown_sec, r.cooldown_sec),
        owner_user_id = CASE WHEN p_clear_owner_user_id THEN NULL
            WHEN p_owner_user_id IS NOT NULL THEN p_owner_user_id
            ELSE r.owner_user_id END,
        summary_template = CASE WHEN p_clear_summary_template THEN NULL
            WHEN p_summary_template IS NOT NULL THEN p_summary_template
            ELSE r.summary_template END,
        message_template = CASE WHEN p_clear_message_template THEN NULL
            WHEN p_message_template IS NOT NULL THEN p_message_template
            ELSE r.message_template END,
        auto_resolve = COALESCE(p_auto_resolve, r.auto_resolve),
        config = COALESCE(p_config, r.config),
        group_by = CASE WHEN p_clear_group_by THEN NULL
            WHEN p_group_by IS NOT NULL THEN p_group_by
            ELSE r.group_by END,
        delivery_mode = COALESCE(p_delivery_mode, r.delivery_mode),
        digest_window_minutes = CASE WHEN p_clear_digest_window THEN NULL
            WHEN p_digest_window_minutes IS NOT NULL THEN p_digest_window_minutes
            ELSE r.digest_window_minutes END,
        runbook_url = CASE WHEN p_clear_runbook_url THEN NULL
            WHEN p_runbook_url IS NOT NULL THEN p_runbook_url
            ELSE r.runbook_url END,
        template_id = CASE WHEN p_clear_template_id THEN NULL
            WHEN p_template_id IS NOT NULL THEN p_template_id
            ELSE r.template_id END,
        updated_at = NOW()
    WHERE r.id = p_id AND r.organization_id = p_organization_id
    RETURNING r.id;
END;
$$;

-- get / list / list_enabled: add template_id to the returned shape (rebuilt on
-- the migration-20006 versions that already carry last_fired_at).
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_get(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, kind VARCHAR,
    enabled BOOLEAN, severity VARCHAR, scope JSONB, dedupe_window_sec INTEGER,
    cooldown_sec INTEGER, destination_group_ids INTEGER[], owner_user_id VARCHAR,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN,
    config JSONB, group_by TEXT[], delivery_mode VARCHAR,
    digest_window_minutes INTEGER, runbook_url VARCHAR, template_id INTEGER,
    last_fired_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT r.id, r.organization_id, r.name, r.kind, r.enabled, r.severity,
        r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        r.owner_user_id, r.summary_template, r.message_template,
        r.auto_resolve, r.config, r.group_by, r.delivery_mode,
        r.digest_window_minutes, r.runbook_url, r.template_id,
        lf.last_fired_at, r.created_at, r.updated_at
    FROM notifications.alert_rules r
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g WHERE g.rule_id = r.id
    ) dest ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(ai.last_triggered_at) AS last_fired_at
        FROM notifications.alert_instances ai WHERE ai.rule_id = r.id
    ) lf ON TRUE
    WHERE r.organization_id = p_organization_id AND r.id = p_id;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list(
    VARCHAR, BOOLEAN, VARCHAR, VARCHAR, INTEGER, INTEGER
);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_list(
    p_organization_id VARCHAR,
    p_enabled         BOOLEAN DEFAULT NULL,
    p_kind            VARCHAR DEFAULT NULL,
    p_query           VARCHAR DEFAULT NULL,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    total_count BIGINT, id INTEGER, organization_id VARCHAR, name VARCHAR,
    kind VARCHAR, enabled BOOLEAN, severity VARCHAR, scope JSONB,
    dedupe_window_sec INTEGER, cooldown_sec INTEGER,
    destination_group_ids INTEGER[], owner_user_id VARCHAR,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN,
    config JSONB, group_by TEXT[], delivery_mode VARCHAR,
    digest_window_minutes INTEGER, runbook_url VARCHAR, template_id INTEGER,
    last_fired_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT * FROM notifications.alert_rules r
        WHERE r.organization_id = p_organization_id
          AND (p_enabled IS NULL OR r.enabled = p_enabled)
          AND (p_kind IS NULL OR r.kind = p_kind)
          AND (p_query IS NULL OR r.name ILIKE '%' || p_query || '%')
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT total.c, r.id, r.organization_id, r.name, r.kind, r.enabled,
        r.severity, r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        r.owner_user_id, r.summary_template, r.message_template,
        r.auto_resolve, r.config, r.group_by, r.delivery_mode,
        r.digest_window_minutes, r.runbook_url, r.template_id,
        lf.last_fired_at, r.created_at, r.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT * FROM filtered ORDER BY name ASC LIMIT p_limit OFFSET p_offset
    ) r ON TRUE
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g WHERE g.rule_id = r.id
    ) dest ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(ai.last_triggered_at) AS last_fired_at
        FROM notifications.alert_instances ai WHERE ai.rule_id = r.id
    ) lf ON TRUE;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list_enabled(VARCHAR);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_list_enabled(
    p_organization_id VARCHAR
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, kind VARCHAR,
    enabled BOOLEAN, severity VARCHAR, scope JSONB, dedupe_window_sec INTEGER,
    cooldown_sec INTEGER, owner_user_id VARCHAR, summary_template TEXT,
    message_template TEXT, auto_resolve BOOLEAN, config JSONB, group_by TEXT[],
    delivery_mode VARCHAR, digest_window_minutes INTEGER, runbook_url VARCHAR,
    template_id INTEGER, destination_group_ids INTEGER[],
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT r.id, r.organization_id, r.name, r.kind, r.enabled, r.severity,
        r.scope, r.dedupe_window_sec, r.cooldown_sec, r.owner_user_id,
        r.summary_template, r.message_template, r.auto_resolve, r.config,
        r.group_by, r.delivery_mode, r.digest_window_minutes, r.runbook_url,
        r.template_id,
        COALESCE(
            (SELECT array_agg(d.destination_group_id ORDER BY d.destination_group_id)
             FROM notifications.alert_rule_destination_groups d WHERE d.rule_id = r.id),
            ARRAY[]::INTEGER[]),
        r.created_at, r.updated_at
    FROM notifications.alert_rules r
    WHERE r.organization_id = p_organization_id AND r.enabled = TRUE
    ORDER BY r.id ASC;
$$;

--------------DOWN
ALTER TABLE notifications.alert_rules DROP COLUMN IF EXISTS template_id;
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_create(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, BOOLEAN, JSONB, INTEGER, INTEGER,
    VARCHAR, TEXT, TEXT, BOOLEAN, JSONB, TEXT[], VARCHAR, INTEGER, VARCHAR, INTEGER
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_update(
    VARCHAR, INTEGER, VARCHAR, BOOLEAN, VARCHAR, JSONB, INTEGER, INTEGER,
    VARCHAR, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, BOOLEAN, JSONB,
    TEXT[], BOOLEAN, VARCHAR, INTEGER, BOOLEAN, VARCHAR, BOOLEAN, INTEGER, BOOLEAN
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_get(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list(VARCHAR, BOOLEAN, VARCHAR, VARCHAR, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list_enabled(VARCHAR);
