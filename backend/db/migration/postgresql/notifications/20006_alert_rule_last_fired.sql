--------------UP
-- Surface "how long since this rule last fired" on the rule list/get so the
-- card grid can render "Quiet · 2d ago". Sourced from the most recent
-- instance trigger; NULL when the rule has never fired. alert_instances is
-- already indexed by rule_id (migration 6306), so the lateral MAX is cheap.
-- RETURNS TABLE shape changes, so the functions are dropped and recreated.

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_get(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
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
    last_fired_at          TIMESTAMPTZ,
    created_at             TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        r.id, r.organization_id, r.name, r.kind, r.enabled, r.severity,
        r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        r.owner_user_id, r.summary_template, r.message_template,
        r.auto_resolve, r.config, r.group_by,
        r.delivery_mode, r.digest_window_minutes, r.runbook_url,
        lf.last_fired_at,
        r.created_at, r.updated_at
    FROM notifications.alert_rules r
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g
        WHERE g.rule_id = r.id
    ) dest ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(ai.last_triggered_at) AS last_fired_at
        FROM notifications.alert_instances ai
        WHERE ai.rule_id = r.id
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
    total_count            BIGINT,
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
    last_fired_at          TIMESTAMPTZ,
    created_at             TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT *
        FROM notifications.alert_rules r
        WHERE r.organization_id = p_organization_id
          AND (p_enabled IS NULL OR r.enabled = p_enabled)
          AND (p_kind IS NULL OR r.kind = p_kind)
          AND (p_query IS NULL OR r.name ILIKE '%' || p_query || '%')
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        r.id, r.organization_id, r.name, r.kind, r.enabled, r.severity,
        r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        r.owner_user_id, r.summary_template, r.message_template,
        r.auto_resolve, r.config, r.group_by,
        r.delivery_mode, r.digest_window_minutes, r.runbook_url,
        lf.last_fired_at,
        r.created_at, r.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY name ASC
        LIMIT p_limit OFFSET p_offset
    ) r ON TRUE
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g
        WHERE g.rule_id = r.id
    ) dest ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(ai.last_triggered_at) AS last_fired_at
        FROM notifications.alert_instances ai
        WHERE ai.rule_id = r.id
    ) lf ON TRUE;
$$;

--------------DOWN
-- Restore the pre-last_fired_at definitions (migration 6518 shape).
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_get(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
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
    created_at             TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        r.id, r.organization_id, r.name, r.kind, r.enabled, r.severity,
        r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        r.owner_user_id, r.summary_template, r.message_template,
        r.auto_resolve, r.config, r.group_by,
        r.delivery_mode, r.digest_window_minutes, r.runbook_url,
        r.created_at, r.updated_at
    FROM notifications.alert_rules r
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g
        WHERE g.rule_id = r.id
    ) dest ON TRUE
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
    total_count            BIGINT,
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
    created_at             TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT *
        FROM notifications.alert_rules r
        WHERE r.organization_id = p_organization_id
          AND (p_enabled IS NULL OR r.enabled = p_enabled)
          AND (p_kind IS NULL OR r.kind = p_kind)
          AND (p_query IS NULL OR r.name ILIKE '%' || p_query || '%')
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        r.id, r.organization_id, r.name, r.kind, r.enabled, r.severity,
        r.scope, r.dedupe_window_sec, r.cooldown_sec,
        COALESCE(dest.destination_group_ids, ARRAY[]::INTEGER[]),
        r.owner_user_id, r.summary_template, r.message_template,
        r.auto_resolve, r.config, r.group_by,
        r.delivery_mode, r.digest_window_minutes, r.runbook_url,
        r.created_at, r.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY name ASC
        LIMIT p_limit OFFSET p_offset
    ) r ON TRUE
    LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(g.destination_group_id ORDER BY g.destination_group_id ASC) AS destination_group_ids
        FROM notifications.alert_rule_destination_groups g
        WHERE g.rule_id = r.id
    ) dest ON TRUE;
$$;
