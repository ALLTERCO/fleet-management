--------------UP
-- Let a rule target integration endpoints (channels) directly, not only via
-- destination groups. Mirrors the alert_rule_destination_groups link table and
-- its replace function. Send-time fan-out unions both sets and dedupes.

CREATE TABLE IF NOT EXISTS notifications.alert_rule_destination_endpoints (
    rule_id      INTEGER     NOT NULL
        REFERENCES notifications.alert_rules(id) ON DELETE CASCADE,
    endpoint_id  INTEGER     NOT NULL
        REFERENCES notifications.integration_endpoints(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT alert_rule_destination_endpoints_pk PRIMARY KEY (rule_id, endpoint_id)
);

-- Replace a rule's directly-targeted endpoints. Rejects ids outside the org so
-- a bad pick fails loud rather than silently dropping a recipient.
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_replace_destination_endpoints(
    p_organization_id           VARCHAR,
    p_rule_id                   INTEGER,
    p_destination_endpoint_ids  JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (
    destination_endpoint_id INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    requested_count INTEGER;
    valid_count INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM notifications.alert_rules r
        WHERE r.id = p_rule_id AND r.organization_id = p_organization_id
    ) THEN
        RETURN;
    END IF;

    SELECT COUNT(*) INTO requested_count
    FROM (
        SELECT DISTINCT (value)::TEXT::INTEGER AS endpoint_id
        FROM jsonb_array_elements(COALESCE(p_destination_endpoint_ids, '[]'::jsonb))
    ) requested;

    SELECT COUNT(*) INTO valid_count
    FROM (
        SELECT DISTINCT e.id AS endpoint_id
        FROM jsonb_array_elements(COALESCE(p_destination_endpoint_ids, '[]'::jsonb)) src(value)
        JOIN notifications.integration_endpoints e
          ON e.id = (src.value)::TEXT::INTEGER
         AND e.organization_id = p_organization_id
    ) valid_requested;

    IF requested_count <> valid_count THEN
        -- DETAIL marks the resource so the RPC layer reports the right field.
        RAISE EXCEPTION 'one or more endpoints do not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'notification_endpoint';
    END IF;

    DELETE FROM notifications.alert_rule_destination_endpoints
    WHERE rule_id = p_rule_id;

    INSERT INTO notifications.alert_rule_destination_endpoints (rule_id, endpoint_id)
    SELECT p_rule_id, valid_requested.endpoint_id
    FROM (
        SELECT DISTINCT e.id AS endpoint_id
        FROM jsonb_array_elements(COALESCE(p_destination_endpoint_ids, '[]'::jsonb)) src(value)
        JOIN notifications.integration_endpoints e
          ON e.id = (src.value)::TEXT::INTEGER
         AND e.organization_id = p_organization_id
    ) valid_requested
    ORDER BY valid_requested.endpoint_id ASC;

    RETURN QUERY
    SELECT de.endpoint_id
    FROM notifications.alert_rule_destination_endpoints de
    WHERE de.rule_id = p_rule_id
    ORDER BY de.endpoint_id ASC;
END;
$$;

-- get / list / list_enabled rebuilt to also surface destination_endpoint_ids
-- alongside destination_group_ids (same aggregation shape).
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_get(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, name VARCHAR, kind VARCHAR,
    enabled BOOLEAN, severity VARCHAR, scope JSONB, dedupe_window_sec INTEGER,
    cooldown_sec INTEGER, destination_group_ids INTEGER[],
    destination_endpoint_ids INTEGER[], owner_user_id VARCHAR,
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
        COALESCE(dest_ep.destination_endpoint_ids, ARRAY[]::INTEGER[]),
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
        SELECT ARRAY_AGG(e.endpoint_id ORDER BY e.endpoint_id ASC) AS destination_endpoint_ids
        FROM notifications.alert_rule_destination_endpoints e WHERE e.rule_id = r.id
    ) dest_ep ON TRUE
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
    destination_group_ids INTEGER[], destination_endpoint_ids INTEGER[],
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
        COALESCE(dest_ep.destination_endpoint_ids, ARRAY[]::INTEGER[]),
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
        SELECT ARRAY_AGG(e.endpoint_id ORDER BY e.endpoint_id ASC) AS destination_endpoint_ids
        FROM notifications.alert_rule_destination_endpoints e WHERE e.rule_id = r.id
    ) dest_ep ON TRUE
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
    destination_endpoint_ids INTEGER[],
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
            (SELECT array_agg(de.endpoint_id ORDER BY de.endpoint_id)
             FROM notifications.alert_rule_destination_endpoints de WHERE de.rule_id = r.id),
            ARRAY[]::INTEGER[]),
        r.created_at, r.updated_at
    FROM notifications.alert_rules r
    WHERE r.organization_id = p_organization_id AND r.enabled = TRUE
    ORDER BY r.id ASC;
$$;

-- Single home for "which endpoints does this rule reach for this alert" —
-- group-expanded UNION directly-picked, deduped, each carrying its stable
-- idempotency_key. Used by the fan-out for both the insert and the re-read.
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_resolved_endpoints(
    p_organization_id          VARCHAR,
    p_rule_id                  INTEGER,
    p_destination_endpoint_ids INTEGER[],
    p_alert_id                 INTEGER,
    p_inbox_item_id            INTEGER
)
RETURNS TABLE (
    endpoint_id     INTEGER,
    provider        VARCHAR,
    idempotency_key TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT
        e.id,
        e.provider,
        FORMAT(
            'alert:%s:inbox:%s:endpoint:%s',
            p_alert_id, COALESCE(p_inbox_item_id, 0), e.id
        )
    FROM notifications.alert_rule_destination_groups rdg
    JOIN notifications.destination_groups dg
      ON dg.id = rdg.destination_group_id
     AND dg.organization_id = p_organization_id
     AND dg.enabled = TRUE
    JOIN notifications.destination_group_members m
      ON m.destination_group_id = dg.id
     AND m.member_type = 'integration_endpoint'
     AND m.member_id ~ '^[0-9]+$'
    JOIN notifications.integration_endpoints e
      ON e.id = m.member_id::INTEGER
     AND e.organization_id = p_organization_id
     AND e.enabled = TRUE
    WHERE rdg.rule_id = p_rule_id

    UNION

    SELECT DISTINCT
        e.id,
        e.provider,
        FORMAT(
            'alert:%s:inbox:%s:endpoint:%s',
            p_alert_id, COALESCE(p_inbox_item_id, 0), e.id
        )
    FROM notifications.integration_endpoints e
    WHERE e.id = ANY(COALESCE(p_destination_endpoint_ids, ARRAY[]::INTEGER[]))
      AND e.organization_id = p_organization_id
      AND e.enabled = TRUE;
$$;

-- Fan-out unions the rule's directly-picked endpoints with its group-expanded
-- endpoints (deduped). Idempotent per (alert,inbox,endpoint) via 6514's
-- idempotency_key + ON CONFLICT. plpgsql with a separate insert then read so the
-- re-read of delivery_jobs is NOT an in-statement re-read of a data-modifying
-- CTE (which trips AfterTriggerSaveEvent under Timescale's FK triggers). The
-- read still returns pre-existing jobs so a retry after a mid-route crash
-- regroups already-inserted jobs.
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_create_batch(
    VARCHAR, INTEGER, INTEGER, INTEGER
);
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_create_batch(
    p_organization_id          VARCHAR,
    p_rule_id                  INTEGER,
    p_alert_id                 INTEGER,
    p_inbox_item_id            INTEGER DEFAULT NULL,
    p_destination_endpoint_ids INTEGER[] DEFAULT '{}'::INTEGER[]
)
RETURNS TABLE (
    id          INTEGER,
    endpoint_id INTEGER,
    provider    VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO notifications.delivery_jobs (
        organization_id, alert_id, inbox_item_id, endpoint_id, state,
        idempotency_key
    )
    SELECT
        p_organization_id, p_alert_id, p_inbox_item_id, ep.endpoint_id,
        'queued', ep.idempotency_key
    FROM notifications.fn_alert_rule_resolved_endpoints(
        p_organization_id, p_rule_id, p_destination_endpoint_ids,
        p_alert_id, p_inbox_item_id
    ) ep
    ON CONFLICT (organization_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
        DO NOTHING;

    RETURN QUERY
    SELECT j.id, j.endpoint_id, ep.provider
    FROM notifications.fn_alert_rule_resolved_endpoints(
        p_organization_id, p_rule_id, p_destination_endpoint_ids,
        p_alert_id, p_inbox_item_id
    ) ep
    JOIN notifications.delivery_jobs j
      ON j.organization_id = p_organization_id
     AND j.idempotency_key = ep.idempotency_key;
END;
$$;

--------------DOWN
-- Restore the migration-6514 (groups-only, idempotent) 4-arg fan-out exactly.
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_create_batch(
    VARCHAR, INTEGER, INTEGER, INTEGER, INTEGER[]
);
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_create_batch(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_alert_id        INTEGER,
    p_inbox_item_id   INTEGER DEFAULT NULL
)
RETURNS TABLE (id INTEGER, endpoint_id INTEGER, provider VARCHAR)
LANGUAGE sql
AS $$
    WITH endpoints AS (
        SELECT DISTINCT
            e.id AS endpoint_id,
            e.provider,
            FORMAT(
                'alert:%s:inbox:%s:endpoint:%s',
                p_alert_id,
                COALESCE(p_inbox_item_id, 0),
                e.id
            ) AS idempotency_key
        FROM notifications.alert_rule_destination_groups rdg
        JOIN notifications.destination_groups dg
          ON dg.id = rdg.destination_group_id
         AND dg.organization_id = p_organization_id
         AND dg.enabled = TRUE
        JOIN notifications.destination_group_members m
          ON m.destination_group_id = dg.id
         AND m.member_type = 'integration_endpoint'
         AND m.member_id ~ '^[0-9]+$'
        JOIN notifications.integration_endpoints e
          ON e.id = m.member_id::INTEGER
         AND e.organization_id = p_organization_id
         AND e.enabled = TRUE
        WHERE rdg.rule_id = p_rule_id
    ),
    inserted AS (
        INSERT INTO notifications.delivery_jobs (
            organization_id, alert_id, inbox_item_id, endpoint_id, state,
            idempotency_key
        )
        SELECT
            p_organization_id, p_alert_id, p_inbox_item_id, e.endpoint_id,
            'queued', e.idempotency_key
        FROM endpoints e
        ON CONFLICT (organization_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            DO NOTHING
        RETURNING id, endpoint_id, idempotency_key
    )
    SELECT i.id, i.endpoint_id, e.provider
    FROM inserted i
    JOIN endpoints e ON e.idempotency_key = i.idempotency_key
    UNION ALL
    SELECT j.id, j.endpoint_id, e.provider
    FROM endpoints e
    JOIN notifications.delivery_jobs j
      ON j.organization_id = p_organization_id
     AND j.idempotency_key = e.idempotency_key
    WHERE NOT EXISTS (
        SELECT 1 FROM inserted i WHERE i.id = j.id
    );
$$;

-- Restore get/list/list_enabled without destination_endpoint_ids (20008 shape).
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

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_resolved_endpoints(
    VARCHAR, INTEGER, INTEGER[], INTEGER, INTEGER
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_replace_destination_endpoints(
    VARCHAR, INTEGER, JSONB
);
DROP TABLE IF EXISTS notifications.alert_rule_destination_endpoints;
