--------------UP
-- Finish the public/data contract rename after the live destination table
-- became notifications.channels.

DO $$
BEGIN
    IF to_regclass('notifications.alert_rule_destination_endpoints') IS NOT NULL
       AND to_regclass('notifications.alert_rule_destination_channels') IS NULL THEN
        -- LINT-IGNORE: additive-only -- contract rename, data preserved.
        ALTER TABLE notifications.alert_rule_destination_endpoints
            RENAME TO alert_rule_destination_channels;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'notifications'
          AND table_name = 'alert_rule_destination_channels'
          AND column_name = 'endpoint_id'
    ) THEN
        -- LINT-IGNORE: additive-only -- contract rename, data preserved.
        ALTER TABLE notifications.alert_rule_destination_channels
            RENAME COLUMN endpoint_id TO channel_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE connamespace = 'notifications'::regnamespace
          AND conname = 'alert_rule_destination_endpoints_pk'
    ) THEN
        ALTER TABLE notifications.alert_rule_destination_channels
            RENAME CONSTRAINT alert_rule_destination_endpoints_pk
            TO alert_rule_destination_channels_pk;
    END IF;
END;
$$;

UPDATE notifications.destination_group_members
SET member_type = 'channel'
WHERE member_type = 'integration_endpoint';

ALTER TABLE notifications.destination_group_members
    DROP CONSTRAINT IF EXISTS destination_group_members_type_valid;
ALTER TABLE notifications.destination_group_members
    ADD CONSTRAINT destination_group_members_type_valid
    CHECK (member_type IN ('user', 'channel', 'push_token'));

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_replace_destination_endpoints(VARCHAR, INTEGER, JSONB);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_replace_destination_channels(
    p_organization_id          VARCHAR,
    p_rule_id                  INTEGER,
    p_destination_channel_ids  JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (
    destination_channel_id INTEGER
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
        SELECT DISTINCT (value)::TEXT::INTEGER AS channel_id
        FROM jsonb_array_elements(COALESCE(p_destination_channel_ids, '[]'::jsonb))
    ) requested;

    SELECT COUNT(*) INTO valid_count
    FROM (
        SELECT DISTINCT c.id AS channel_id
        FROM jsonb_array_elements(COALESCE(p_destination_channel_ids, '[]'::jsonb)) src(value)
        JOIN notifications.channels c
          ON c.id = (src.value)::TEXT::INTEGER
         AND c.organization_id = p_organization_id
    ) valid_requested;

    IF requested_count <> valid_count THEN
        RAISE EXCEPTION 'one or more channels do not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'notification_channel';
    END IF;

    DELETE FROM notifications.alert_rule_destination_channels
    WHERE rule_id = p_rule_id;

    INSERT INTO notifications.alert_rule_destination_channels (rule_id, channel_id)
    SELECT p_rule_id, valid_requested.channel_id
    FROM (
        SELECT DISTINCT c.id AS channel_id
        FROM jsonb_array_elements(COALESCE(p_destination_channel_ids, '[]'::jsonb)) src(value)
        JOIN notifications.channels c
          ON c.id = (src.value)::TEXT::INTEGER
         AND c.organization_id = p_organization_id
    ) valid_requested
    ORDER BY valid_requested.channel_id ASC;

    RETURN QUERY
    SELECT dc.channel_id
    FROM notifications.alert_rule_destination_channels dc
    WHERE dc.rule_id = p_rule_id
    ORDER BY dc.channel_id ASC;
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
    WHERE r.organization_id = p_organization_id AND r.enabled = TRUE
    ORDER BY r.id ASC;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_rule_resolved_endpoints(
    VARCHAR, INTEGER, INTEGER[], INTEGER, INTEGER
);
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_resolved_channels(
    p_organization_id         VARCHAR,
    p_rule_id                 INTEGER,
    p_destination_channel_ids INTEGER[],
    p_alert_id                INTEGER,
    p_inbox_item_id           INTEGER
)
RETURNS TABLE (
    channel_id       INTEGER,
    provider         VARCHAR,
    idempotency_key  TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT
        c.id,
        c.provider,
        FORMAT(
            'alert:%s:inbox:%s:channel:%s',
            p_alert_id, COALESCE(p_inbox_item_id, 0), c.id
        )
    FROM notifications.alert_rule_destination_groups rdg
    JOIN notifications.destination_groups dg
      ON dg.id = rdg.destination_group_id
     AND dg.organization_id = p_organization_id
     AND dg.enabled = TRUE
    JOIN notifications.destination_group_members m
      ON m.destination_group_id = dg.id
     AND m.member_type = 'channel'
     AND m.member_id ~ '^[0-9]+$'
    JOIN notifications.channels c
      ON c.id = m.member_id::INTEGER
     AND c.organization_id = p_organization_id
     AND c.enabled = TRUE
    WHERE rdg.rule_id = p_rule_id

    UNION

    SELECT DISTINCT
        c.id,
        c.provider,
        FORMAT(
            'alert:%s:inbox:%s:channel:%s',
            p_alert_id, COALESCE(p_inbox_item_id, 0), c.id
        )
    FROM notifications.channels c
    WHERE c.id = ANY(COALESCE(p_destination_channel_ids, ARRAY[]::INTEGER[]))
      AND c.organization_id = p_organization_id
      AND c.enabled = TRUE;
$$;

DROP FUNCTION IF EXISTS notifications.fn_delivery_job_create_batch(
    VARCHAR, INTEGER, INTEGER, INTEGER, INTEGER[]
);
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_create_batch(
    p_organization_id         VARCHAR,
    p_rule_id                 INTEGER,
    p_alert_id                INTEGER,
    p_inbox_item_id           INTEGER DEFAULT NULL,
    p_destination_channel_ids INTEGER[] DEFAULT '{}'::INTEGER[]
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
        p_organization_id, p_alert_id, p_inbox_item_id, ch.channel_id,
        'queued', ch.idempotency_key
    FROM notifications.fn_alert_rule_resolved_channels(
        p_organization_id, p_rule_id, p_destination_channel_ids,
        p_alert_id, p_inbox_item_id
    ) ch
    ON CONFLICT (organization_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
        DO NOTHING;

    RETURN QUERY
    SELECT j.id, j.endpoint_id, ch.provider
    FROM notifications.fn_alert_rule_resolved_channels(
        p_organization_id, p_rule_id, p_destination_channel_ids,
        p_alert_id, p_inbox_item_id
    ) ch
    JOIN notifications.delivery_jobs j
      ON j.organization_id = p_organization_id
     AND j.idempotency_key = ch.idempotency_key;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_delivery_job_create_for_contact_points(
    VARCHAR, INTEGER[], INTEGER[], INTEGER, INTEGER
);
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_create_for_contact_points(
    p_organization_id        VARCHAR,
    p_destination_group_ids  INTEGER[],
    p_channel_ids            INTEGER[],
    p_alert_id               INTEGER,
    p_inbox_item_id          INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id          INTEGER,
    endpoint_id INTEGER,
    provider    VARCHAR
)
LANGUAGE sql
AS $$
    WITH group_channels AS (
        SELECT DISTINCT c.id AS channel_id, c.provider
        FROM notifications.destination_groups dg
        JOIN notifications.destination_group_members m
          ON m.destination_group_id = dg.id
         AND m.member_type = 'channel'
         AND m.member_id ~ '^[0-9]+$'
        JOIN notifications.channels c
          ON c.id = m.member_id::INTEGER
         AND c.organization_id = p_organization_id
         AND c.enabled = TRUE
        WHERE dg.organization_id = p_organization_id
          AND dg.enabled = TRUE
          AND dg.id = ANY(COALESCE(p_destination_group_ids, ARRAY[]::INTEGER[]))
    ),
    direct_channels AS (
        SELECT DISTINCT c.id AS channel_id, c.provider
        FROM notifications.channels c
        WHERE c.organization_id = p_organization_id
          AND c.enabled = TRUE
          AND c.id = ANY(COALESCE(p_channel_ids, ARRAY[]::INTEGER[]))
    ),
    channels AS (
        SELECT
            channel_id,
            provider,
            FORMAT(
                'alert:%s:inbox:%s:channel:%s',
                p_alert_id,
                COALESCE(p_inbox_item_id, 0),
                channel_id
            ) AS idempotency_key
        FROM (
            SELECT channel_id, provider FROM group_channels
            UNION
            SELECT channel_id, provider FROM direct_channels
        ) combined
    ),
    inserted AS (
        INSERT INTO notifications.delivery_jobs (
            organization_id, alert_id, inbox_item_id, endpoint_id, state,
            idempotency_key
        )
        SELECT
            p_organization_id,
            p_alert_id,
            p_inbox_item_id,
            ch.channel_id,
            'queued',
            ch.idempotency_key
        FROM channels ch
        ON CONFLICT (organization_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            DO NOTHING
        RETURNING id, endpoint_id, idempotency_key
    )
    SELECT i.id, i.endpoint_id, ch.provider
    FROM inserted i
    JOIN channels ch ON ch.idempotency_key = i.idempotency_key
    UNION ALL
    SELECT j.id, j.endpoint_id, ch.provider
    FROM channels ch
    JOIN notifications.delivery_jobs j
      ON j.organization_id = p_organization_id
     AND j.idempotency_key = ch.idempotency_key
    WHERE NOT EXISTS (
        SELECT 1 FROM inserted i WHERE i.id = j.id
    );
$$;

CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_for_group(
    p_alert_ids   INTEGER[],
    p_endpoint_id INTEGER
)
RETURNS TABLE (
    id           INTEGER,
    endpoint_id  INTEGER,
    provider     VARCHAR
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_latest_ids INTEGER[];
BEGIN
    SELECT COALESCE(ARRAY_AGG(t.id), ARRAY[]::INTEGER[])
    INTO v_latest_ids
    FROM (
        SELECT DISTINCT ON (j.alert_id) j.id
        FROM notifications.delivery_jobs j
        WHERE j.alert_id = ANY(p_alert_ids)
          AND j.endpoint_id = p_endpoint_id
          AND j.state = 'queued'
        ORDER BY j.alert_id, j.created_at DESC, j.id DESC
    ) t;

    UPDATE notifications.delivery_jobs
    SET state = 'superseded',
        completed_at = NOW()
    WHERE alert_id = ANY(p_alert_ids)
      AND endpoint_id = p_endpoint_id
      AND state = 'queued'
      AND NOT (id = ANY(v_latest_ids));

    RETURN QUERY
    SELECT j.id, j.endpoint_id, c.provider
    FROM notifications.delivery_jobs j
    JOIN notifications.channels c ON c.id = j.endpoint_id
    WHERE j.id = ANY(v_latest_ids);
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_message_template_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (deleted_id INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM notifications.alert_rules
        WHERE organization_id = p_organization_id AND template_id = p_id
    ) OR EXISTS (
        SELECT 1 FROM notifications.channels
        WHERE organization_id = p_organization_id
          AND config->>'templateId' ~ '^[0-9]+$'
          AND (config->>'templateId')::int = p_id
    ) THEN
        RAISE EXCEPTION 'message_template % is still in use', p_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN QUERY
    DELETE FROM notifications.message_template
    WHERE id = p_id AND organization_id = p_organization_id
    RETURNING id AS deleted_id;
END;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_for_group(
    p_alert_ids   INTEGER[],
    p_endpoint_id INTEGER
)
RETURNS TABLE (
    id           INTEGER,
    endpoint_id  INTEGER,
    provider     VARCHAR
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_latest_ids INTEGER[];
BEGIN
    SELECT COALESCE(ARRAY_AGG(t.id), ARRAY[]::INTEGER[])
    INTO v_latest_ids
    FROM (
        SELECT DISTINCT ON (j.alert_id) j.id
        FROM notifications.delivery_jobs j
        WHERE j.alert_id = ANY(p_alert_ids)
          AND j.endpoint_id = p_endpoint_id
          AND j.state = 'queued'
        ORDER BY j.alert_id, j.created_at DESC, j.id DESC
    ) t;

    UPDATE notifications.delivery_jobs
    SET state = 'superseded',
        completed_at = NOW()
    WHERE alert_id = ANY(p_alert_ids)
      AND endpoint_id = p_endpoint_id
      AND state = 'queued'
      AND NOT (id = ANY(v_latest_ids));

    RETURN QUERY
    SELECT j.id, j.endpoint_id, e.provider
    FROM notifications.delivery_jobs j
    JOIN notifications.integration_endpoints e ON e.id = j.endpoint_id
    WHERE j.id = ANY(v_latest_ids);
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_message_template_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (deleted_id INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM notifications.alert_rules
        WHERE organization_id = p_organization_id AND template_id = p_id
    ) OR EXISTS (
        SELECT 1 FROM notifications.integration_endpoints
        WHERE organization_id = p_organization_id
          AND config->>'templateId' ~ '^[0-9]+$'
          AND (config->>'templateId')::int = p_id
    ) THEN
        RAISE EXCEPTION 'message_template % is still in use', p_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN QUERY
    DELETE FROM notifications.message_template
    WHERE id = p_id AND organization_id = p_organization_id
    RETURNING id AS deleted_id;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_delivery_job_create_for_contact_points(
    VARCHAR, INTEGER[], INTEGER[], INTEGER, INTEGER
);
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_create_batch(
    VARCHAR, INTEGER, INTEGER, INTEGER, INTEGER[]
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_resolved_channels(
    VARCHAR, INTEGER, INTEGER[], INTEGER, INTEGER
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list_enabled(VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_list(
    VARCHAR, BOOLEAN, VARCHAR, VARCHAR, INTEGER, INTEGER
);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_get(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_replace_destination_channels(VARCHAR, INTEGER, JSONB);

UPDATE notifications.destination_group_members
SET member_type = 'integration_endpoint'
WHERE member_type = 'channel';

ALTER TABLE notifications.destination_group_members
    DROP CONSTRAINT IF EXISTS destination_group_members_type_valid;
ALTER TABLE notifications.destination_group_members
    ADD CONSTRAINT destination_group_members_type_valid
    CHECK (member_type IN ('user', 'integration_endpoint', 'push_token'));

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'notifications'
          AND table_name = 'alert_rule_destination_channels'
          AND column_name = 'channel_id'
    ) THEN
        ALTER TABLE notifications.alert_rule_destination_channels
            RENAME COLUMN channel_id TO endpoint_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE connamespace = 'notifications'::regnamespace
          AND conname = 'alert_rule_destination_channels_pk'
    ) THEN
        ALTER TABLE notifications.alert_rule_destination_channels
            RENAME CONSTRAINT alert_rule_destination_channels_pk
            TO alert_rule_destination_endpoints_pk;
    END IF;

    IF to_regclass('notifications.alert_rule_destination_channels') IS NOT NULL
       AND to_regclass('notifications.alert_rule_destination_endpoints') IS NULL THEN
        ALTER TABLE notifications.alert_rule_destination_channels
            RENAME TO alert_rule_destination_endpoints;
    END IF;
END;
$$;
