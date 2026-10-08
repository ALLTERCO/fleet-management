-- last_fired_at was a second copy of "when did this rule fire".
--
-- It read MAX(alert_instances.last_triggered_at). That column is bumped by
-- fn_alert_instance_mark_evaluation_state on EVERY sweep tick, including a
-- no_data mark for a device that has never reported. So a rule that never fired
-- still showed a recent last_fired_at. Measured: 3 days 11 hours of drift on
-- rows whose state is no_data and which never fired.
--
-- A fire is recorded once, in notifications.alert_transitions with
-- action = 'triggered'. That row is written only by fn_alert_instance_upsert.
-- 6934 widened the action CHECK to carry evaluation states too, so 'triggered'
-- means a real fire and nothing else.
--
-- This is the reader half. It ships first because 7313's comment names this
-- reader as the whole reason last_triggered_at is bumped unconditionally, and
-- the write cannot be removed while a reader depends on it.
--
-- The index is needed: alert_transitions_by_alert is (alert_id, created_at DESC)
-- with no action column, so it cannot serve a filter on action.
--------------UP
SET search_path TO notifications, public;

CREATE INDEX IF NOT EXISTS alert_transitions_triggered_by_alert_idx
    ON notifications.alert_transitions (alert_id, created_at DESC)
    WHERE action = 'triggered';

-- These signatures change their return type. CREATE OR REPLACE cannot do that:
-- PostgreSQL raises 42P13 and the whole migration fails, so the backend never
-- boots. Dropping first is safe because the UP block runs as one transaction.
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

-- Return type changed; CREATE OR REPLACE cannot. Dropped first (one txn).
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

--------------DOWN
DROP INDEX IF EXISTS notifications.alert_transitions_triggered_by_alert_idx;

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
