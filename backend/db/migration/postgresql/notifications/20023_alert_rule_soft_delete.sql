--------------UP
-- Alert history references alert_rules with ON DELETE RESTRICT. A rule delete
-- must therefore retire the rule, not remove the row that history points to.
ALTER TABLE notifications.alert_rules
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DROP INDEX IF EXISTS notifications.alert_rules_name_by_org;
CREATE UNIQUE INDEX IF NOT EXISTS alert_rules_name_by_org
    ON notifications.alert_rules (organization_id, LOWER(name))
    WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS notifications.alert_rules_by_org_kind;
CREATE INDEX IF NOT EXISTS alert_rules_by_org_kind
    ON notifications.alert_rules (organization_id, kind, enabled)
    WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE notifications.alert_rules r
    SET enabled = FALSE,
        deleted_at = COALESCE(r.deleted_at, NOW()),
        updated_at = NOW()
    WHERE r.id = p_id
      AND r.organization_id = p_organization_id
      AND r.deleted_at IS NULL
    RETURNING r.id;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_update(
    VARCHAR, INTEGER, VARCHAR, BOOLEAN, VARCHAR, JSONB, INTEGER, INTEGER,
    VARCHAR, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, BOOLEAN, JSONB,
    TEXT[], BOOLEAN, VARCHAR, INTEGER, BOOLEAN, VARCHAR, BOOLEAN, INTEGER, BOOLEAN
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
    group_by               TEXT[],
    delivery_mode          VARCHAR,
    digest_window_minutes  INTEGER,
    runbook_url            VARCHAR,
    template_id            INTEGER,
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
            group_by = CASE
                WHEN p_clear_group_by THEN NULL
                WHEN p_group_by IS NOT NULL THEN p_group_by
                ELSE r.group_by
            END,
            delivery_mode = COALESCE(p_delivery_mode, r.delivery_mode),
            digest_window_minutes = CASE
                WHEN p_clear_digest_window THEN NULL
                WHEN p_digest_window_minutes IS NOT NULL THEN p_digest_window_minutes
                ELSE r.digest_window_minutes
            END,
            runbook_url = CASE
                WHEN p_clear_runbook_url THEN NULL
                WHEN p_runbook_url IS NOT NULL THEN p_runbook_url
                ELSE r.runbook_url
            END,
            template_id = CASE
                WHEN p_clear_template_id THEN NULL
                WHEN p_template_id IS NOT NULL THEN p_template_id
                ELSE r.template_id
            END,
            updated_at = NOW()
        WHERE r.id = p_id
          AND r.organization_id = p_organization_id
          AND r.deleted_at IS NULL
        RETURNING r.*
    )
    SELECT
        u.id, u.organization_id, u.name, u.kind, u.enabled, u.severity,
        u.scope, u.dedupe_window_sec, u.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        u.owner_user_id, u.summary_template, u.message_template,
        u.auto_resolve, u.config, u.group_by,
        u.delivery_mode, u.digest_window_minutes, u.runbook_url,
        u.template_id, u.created_at, u.updated_at
    FROM updated u
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g
        WHERE g.rule_id = u.id
    ) dest ON TRUE;
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
        SELECT MAX(ai.last_triggered_at) AS last_fired_at
        FROM notifications.alert_instances ai WHERE ai.rule_id = r.id
    ) lf ON TRUE
    WHERE r.organization_id = p_organization_id
      AND r.id = p_id
      AND r.deleted_at IS NULL;
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

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_find_duplicate(
    p_organization_id   VARCHAR,
    p_kind              VARCHAR,
    p_severity          VARCHAR,
    p_scope             JSONB,
    p_config            JSONB,
    p_dedupe_window_sec INTEGER,
    p_cooldown_sec      INTEGER,
    p_exclude_id        INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id   INTEGER,
    name VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT r.id, r.name
    FROM notifications.alert_rules r
    WHERE r.organization_id = p_organization_id
      AND r.deleted_at IS NULL
      AND r.spec_hash = md5(
              p_kind                        || '|' ||
              p_severity                    || '|' ||
              p_scope::text                 || '|' ||
              p_config::text                || '|' ||
              p_dedupe_window_sec::text     || '|' ||
              p_cooldown_sec::text
          )
      AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
    ORDER BY r.id
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_sweep_orgs()
RETURNS TABLE (organization_id VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT r.organization_id
    FROM notifications.alert_rules r
    WHERE r.enabled
      AND r.deleted_at IS NULL
      AND r.kind IN (
          'heartbeat',
          'energy_consumption_threshold',
          'rate_of_change',
          'stuck_sensor'
      );
$$;

--------------DOWN
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM notifications.alert_rules WHERE deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot roll back alert rule soft-delete after rules have been deleted';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_update(
    VARCHAR, INTEGER, VARCHAR, BOOLEAN, VARCHAR, JSONB, INTEGER, INTEGER,
    VARCHAR, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, BOOLEAN, JSONB,
    TEXT[], BOOLEAN, VARCHAR, INTEGER, BOOLEAN, VARCHAR, BOOLEAN, INTEGER, BOOLEAN
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
    group_by               TEXT[],
    delivery_mode          VARCHAR,
    digest_window_minutes  INTEGER,
    runbook_url            VARCHAR,
    template_id            INTEGER,
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
            group_by = CASE
                WHEN p_clear_group_by THEN NULL
                WHEN p_group_by IS NOT NULL THEN p_group_by
                ELSE r.group_by
            END,
            delivery_mode = COALESCE(p_delivery_mode, r.delivery_mode),
            digest_window_minutes = CASE
                WHEN p_clear_digest_window THEN NULL
                WHEN p_digest_window_minutes IS NOT NULL THEN p_digest_window_minutes
                ELSE r.digest_window_minutes
            END,
            runbook_url = CASE
                WHEN p_clear_runbook_url THEN NULL
                WHEN p_runbook_url IS NOT NULL THEN p_runbook_url
                ELSE r.runbook_url
            END,
            template_id = CASE
                WHEN p_clear_template_id THEN NULL
                WHEN p_template_id IS NOT NULL THEN p_template_id
                ELSE r.template_id
            END,
            updated_at = NOW()
        WHERE r.id = p_id
          AND r.organization_id = p_organization_id
        RETURNING r.*
    )
    SELECT
        u.id, u.organization_id, u.name, u.kind, u.enabled, u.severity,
        u.scope, u.dedupe_window_sec, u.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        u.owner_user_id, u.summary_template, u.message_template,
        u.auto_resolve, u.config, u.group_by,
        u.delivery_mode, u.digest_window_minutes, u.runbook_url,
        u.template_id, u.created_at, u.updated_at
    FROM updated u
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g
        WHERE g.rule_id = u.id
    ) dest ON TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    DELETE FROM notifications.alert_rules
    WHERE notifications.alert_rules.id = p_id
      AND notifications.alert_rules.organization_id = p_organization_id
    RETURNING notifications.alert_rules.id;
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
        SELECT MAX(ai.last_triggered_at) AS last_fired_at
        FROM notifications.alert_instances ai WHERE ai.rule_id = r.id
    ) lf ON TRUE
    WHERE r.organization_id = p_organization_id
      AND r.id = p_id;
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
    ORDER BY r.id ASC;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_find_duplicate(
    p_organization_id   VARCHAR,
    p_kind              VARCHAR,
    p_severity          VARCHAR,
    p_scope             JSONB,
    p_config            JSONB,
    p_dedupe_window_sec INTEGER,
    p_cooldown_sec      INTEGER,
    p_exclude_id        INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id   INTEGER,
    name VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT r.id, r.name
    FROM notifications.alert_rules r
    WHERE r.organization_id = p_organization_id
      AND r.spec_hash = md5(
              p_kind                        || '|' ||
              p_severity                    || '|' ||
              p_scope::text                 || '|' ||
              p_config::text                || '|' ||
              p_dedupe_window_sec::text     || '|' ||
              p_cooldown_sec::text
          )
      AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
    ORDER BY r.id
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_sweep_orgs()
RETURNS TABLE (organization_id VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT r.organization_id
    FROM notifications.alert_rules r
    WHERE r.enabled
      AND r.kind IN (
          'heartbeat',
          'energy_consumption_threshold',
          'rate_of_change',
          'stuck_sensor'
      );
$$;

DROP INDEX IF EXISTS notifications.alert_rules_name_by_org;
CREATE UNIQUE INDEX IF NOT EXISTS alert_rules_name_by_org
    ON notifications.alert_rules (organization_id, LOWER(name));

DROP INDEX IF EXISTS notifications.alert_rules_by_org_kind;
CREATE INDEX IF NOT EXISTS alert_rules_by_org_kind
    ON notifications.alert_rules (organization_id, kind, enabled);

ALTER TABLE notifications.alert_rules
    DROP COLUMN IF EXISTS deleted_at;
