--------------UP
-- "Only alert me between 02:00 and 05:00."
--
-- One JSONB column rather than four scalars, matching how `scope` and `config`
-- are already stored: the window is read and written as a whole, never queried
-- field-by-field in SQL, and the shape mirrors TariffWindowSpec so a window
-- means the same thing here as it does in billing.
--
--   {"startTime":"02:00","endTime":"05:00","daysMask":127,"timezone":"Europe/Sofia"}
--
-- NULL means always active, which is every rule that exists today. The shape is
-- validated by the API schema, not by a CHECK: a window the backend cannot read
-- must fail OPEN (the rule still fires) rather than block the write, because a
-- muted safety alert is invisible and a rejected save is not.
ALTER TABLE notifications.alert_rules
    ADD COLUMN IF NOT EXISTS active_window JSONB;

-- create: accept + store p_active_window.
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_create(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, BOOLEAN, JSONB, INTEGER, INTEGER,
    VARCHAR, TEXT, TEXT, BOOLEAN, JSONB, TEXT[], VARCHAR, INTEGER, VARCHAR,
    INTEGER
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
    p_template_id            INTEGER DEFAULT NULL,
    p_active_window          JSONB DEFAULT NULL
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
        group_by, delivery_mode, digest_window_minutes, runbook_url,
        template_id, active_window
    )
    VALUES (
        p_organization_id, p_name, p_kind, COALESCE(p_enabled, TRUE),
        p_severity, COALESCE(p_scope, '{}'::jsonb),
        COALESCE(p_dedupe_window_sec, 0), COALESCE(p_cooldown_sec, 0),
        p_owner_user_id, p_summary_template, p_message_template,
        COALESCE(p_auto_resolve, TRUE), COALESCE(p_config, '{}'::jsonb),
        p_group_by, COALESCE(p_delivery_mode, 'instant'),
        p_digest_window_minutes, p_runbook_url, p_template_id, p_active_window
    )
    RETURNING alert_rules.id;
END;
$$;

-- update: add p_active_window + p_clear_active_window, following the
-- digest-window pattern (a JSON value cannot express "clear me" on its own).
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_update(
    VARCHAR, INTEGER, VARCHAR, BOOLEAN, VARCHAR, JSONB, INTEGER, INTEGER,
    VARCHAR, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, BOOLEAN, JSONB,
    TEXT[], BOOLEAN, VARCHAR, INTEGER, BOOLEAN, VARCHAR, BOOLEAN, INTEGER,
    BOOLEAN
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
    p_clear_template_id         BOOLEAN DEFAULT FALSE,
    p_active_window             JSONB DEFAULT NULL,
    p_clear_active_window       BOOLEAN DEFAULT FALSE
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
        active_window = CASE WHEN p_clear_active_window THEN NULL
            WHEN p_active_window IS NOT NULL THEN p_active_window
            ELSE r.active_window END,
        updated_at = NOW()
    WHERE r.id = p_id AND r.organization_id = p_organization_id
    RETURNING r.id;
END;
$$;

-- get / list / list_enabled: add active_window to the returned shape. Rebuilt
-- on the migration-20033 (get/list) and 20023 (list_enabled) versions.
-- Return type changes, so CREATE OR REPLACE cannot: 42P13 would fail the whole
-- migration and the backend would never boot. Dropping first is safe because
-- the UP block runs as one transaction.
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_get(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, kind VARCHAR,
    enabled BOOLEAN, severity VARCHAR, scope JSONB, dedupe_window_sec INTEGER,
    cooldown_sec INTEGER, destination_group_ids INTEGER[],
    destination_channel_ids INTEGER[], owner_user_id VARCHAR,
    summary_template TEXT, message_template TEXT, auto_resolve BOOLEAN,
    config JSONB, group_by TEXT[], delivery_mode VARCHAR,
    digest_window_minutes INTEGER, runbook_url VARCHAR, template_id INTEGER,
    active_window JSONB,
    last_fired_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT r.id, r.organization_id, r.name, r.kind, r.enabled, r.severity,
        r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        COALESCE(dest_ch.destination_channel_ids, ARRAY[]::INTEGER[]),
        r.owner_user_id, r.summary_template, r.message_template,
        r.auto_resolve, r.config, r.group_by, r.delivery_mode,
        r.digest_window_minutes, r.runbook_url, r.template_id, r.active_window,
        lf.last_fired_at, r.created_at, r.updated_at
    FROM notifications.alert_rules r
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g WHERE g.rule_id = r.id
    ) dest ON TRUE
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(c.channel_id ORDER BY c.channel_id ASC) AS destination_channel_ids
        FROM notifications.alert_rule_destination_channels c WHERE c.rule_id = r.id
    ) dest_ch ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(t.created_at) AS last_fired_at
        FROM notifications.alert_transitions t
        JOIN notifications.alert_instances ai ON ai.id = t.alert_id
        WHERE ai.rule_id = r.id
          AND t.action = 'triggered'
    ) lf ON TRUE
    WHERE r.organization_id = p_organization_id
      AND r.id = p_id
      AND r.deleted_at IS NULL;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list(VARCHAR, BOOLEAN, VARCHAR, VARCHAR, INTEGER, INTEGER);
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
    destination_group_ids INTEGER[], destination_channel_ids INTEGER[],
    owner_user_id VARCHAR, summary_template TEXT, message_template TEXT,
    auto_resolve BOOLEAN, config JSONB, group_by TEXT[], delivery_mode VARCHAR,
    digest_window_minutes INTEGER, runbook_url VARCHAR, template_id INTEGER,
    active_window JSONB,
    last_fired_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT * FROM notifications.alert_rules r
        WHERE r.organization_id = p_organization_id
          AND r.deleted_at IS NULL
          AND (p_enabled IS NULL OR r.enabled = p_enabled)
          AND (p_kind IS NULL OR r.kind = p_kind)
          AND (p_query IS NULL OR r.name ILIKE '%' || p_query || '%')
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT total.c, r.id, r.organization_id, r.name, r.kind, r.enabled,
        r.severity, r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        COALESCE(dest_ch.destination_channel_ids, ARRAY[]::INTEGER[]),
        r.owner_user_id, r.summary_template, r.message_template,
        r.auto_resolve, r.config, r.group_by, r.delivery_mode,
        r.digest_window_minutes, r.runbook_url, r.template_id, r.active_window,
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
        SELECT ARRAY_AGG(c.channel_id ORDER BY c.channel_id ASC) AS destination_channel_ids
        FROM notifications.alert_rule_destination_channels c WHERE c.rule_id = r.id
    ) dest_ch ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(t.created_at) AS last_fired_at
        FROM notifications.alert_transitions t
        JOIN notifications.alert_instances ai ON ai.id = t.alert_id
        WHERE ai.rule_id = r.id
          AND t.action = 'triggered'
    ) lf ON TRUE;
$$;

-- The one the engine actually reads. Without active_window here the column is
-- stored, returned by the API, shown in the UI — and ignored at fire time.
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
    template_id INTEGER, active_window JSONB, destination_group_ids INTEGER[],
    destination_channel_ids INTEGER[],
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT r.id, r.organization_id, r.name, r.kind, r.enabled, r.severity,
        r.scope, r.dedupe_window_sec, r.cooldown_sec, r.owner_user_id,
        r.summary_template, r.message_template, r.auto_resolve, r.config,
        r.group_by, r.delivery_mode, r.digest_window_minutes, r.runbook_url,
        r.template_id, r.active_window,
        COALESCE(
            (SELECT array_agg(d.destination_group_id ORDER BY d.destination_group_id)
             FROM notifications.alert_rule_destination_groups d WHERE d.rule_id = r.id),
            ARRAY[]::INTEGER[]),
        COALESCE(
            (SELECT array_agg(dc.channel_id ORDER BY dc.channel_id)
             FROM notifications.alert_rule_destination_channels dc WHERE dc.rule_id = r.id),
            ARRAY[]::INTEGER[]),
        r.created_at, r.updated_at
    FROM notifications.alert_rules r
    WHERE r.organization_id = p_organization_id
      AND r.enabled = TRUE
      AND r.deleted_at IS NULL
    ORDER BY r.id ASC;
$$;

--------------DOWN
-- Restore the pre-active_window signatures (20033 for get/list, 20023 for
-- list_enabled, 20008 for create, 20023 for update). The column is dropped
-- last, after nothing references it.
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_create(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, BOOLEAN, JSONB, INTEGER, INTEGER,
    VARCHAR, TEXT, TEXT, BOOLEAN, JSONB, TEXT[], VARCHAR, INTEGER, VARCHAR,
    INTEGER, JSONB
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

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_update(
    VARCHAR, INTEGER, VARCHAR, BOOLEAN, VARCHAR, JSONB, INTEGER, INTEGER,
    VARCHAR, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, BOOLEAN, JSONB,
    TEXT[], BOOLEAN, VARCHAR, INTEGER, BOOLEAN, VARCHAR, BOOLEAN, INTEGER,
    BOOLEAN, JSONB, BOOLEAN
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

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_get(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, kind VARCHAR,
    enabled BOOLEAN, severity VARCHAR, scope JSONB, dedupe_window_sec INTEGER,
    cooldown_sec INTEGER, destination_group_ids INTEGER[],
    destination_channel_ids INTEGER[], owner_user_id VARCHAR,
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
        COALESCE(dest_ch.destination_channel_ids, ARRAY[]::INTEGER[]),
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
        SELECT ARRAY_AGG(c.channel_id ORDER BY c.channel_id ASC) AS destination_channel_ids
        FROM notifications.alert_rule_destination_channels c WHERE c.rule_id = r.id
    ) dest_ch ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(t.created_at) AS last_fired_at
        FROM notifications.alert_transitions t
        JOIN notifications.alert_instances ai ON ai.id = t.alert_id
        WHERE ai.rule_id = r.id
          AND t.action = 'triggered'
    ) lf ON TRUE
    WHERE r.organization_id = p_organization_id
      AND r.id = p_id
      AND r.deleted_at IS NULL;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list(VARCHAR, BOOLEAN, VARCHAR, VARCHAR, INTEGER, INTEGER);
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
    destination_group_ids INTEGER[], destination_channel_ids INTEGER[],
    owner_user_id VARCHAR, summary_template TEXT, message_template TEXT,
    auto_resolve BOOLEAN, config JSONB, group_by TEXT[], delivery_mode VARCHAR,
    digest_window_minutes INTEGER, runbook_url VARCHAR, template_id INTEGER,
    last_fired_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT * FROM notifications.alert_rules r
        WHERE r.organization_id = p_organization_id
          AND r.deleted_at IS NULL
          AND (p_enabled IS NULL OR r.enabled = p_enabled)
          AND (p_kind IS NULL OR r.kind = p_kind)
          AND (p_query IS NULL OR r.name ILIKE '%' || p_query || '%')
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT total.c, r.id, r.organization_id, r.name, r.kind, r.enabled,
        r.severity, r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        COALESCE(dest_ch.destination_channel_ids, ARRAY[]::INTEGER[]),
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
        SELECT ARRAY_AGG(c.channel_id ORDER BY c.channel_id ASC) AS destination_channel_ids
        FROM notifications.alert_rule_destination_channels c WHERE c.rule_id = r.id
    ) dest_ch ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(t.created_at) AS last_fired_at
        FROM notifications.alert_transitions t
        JOIN notifications.alert_instances ai ON ai.id = t.alert_id
        WHERE ai.rule_id = r.id
          AND t.action = 'triggered'
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
    destination_channel_ids INTEGER[],
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
        COALESCE(
            (SELECT array_agg(dc.channel_id ORDER BY dc.channel_id)
             FROM notifications.alert_rule_destination_channels dc WHERE dc.rule_id = r.id),
            ARRAY[]::INTEGER[]),
        r.created_at, r.updated_at
    FROM notifications.alert_rules r
    WHERE r.organization_id = p_organization_id
      AND r.enabled = TRUE
      AND r.deleted_at IS NULL
    ORDER BY r.id ASC;
$$;

ALTER TABLE notifications.alert_rules DROP COLUMN IF EXISTS active_window;
