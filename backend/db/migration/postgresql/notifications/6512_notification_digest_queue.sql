--------------UP
ALTER TABLE notifications.inbox_items
    DROP CONSTRAINT IF EXISTS inbox_items_kind_valid;

ALTER TABLE notifications.inbox_items
    ADD CONSTRAINT inbox_items_kind_valid CHECK (kind IN (
        'alert_created','alert_updated','alert_resolved','alert_digest'
    ));

CREATE TABLE IF NOT EXISTS notifications.notification_digest_items (
    id                  BIGSERIAL    PRIMARY KEY,
    organization_id     VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    user_id             VARCHAR(255) NOT NULL,
    kind                VARCHAR(32)  NOT NULL,
    alert_id            INTEGER      REFERENCES notifications.alert_instances(id) ON DELETE SET NULL,
    source_subject_type VARCHAR(24),
    source_subject_id   VARCHAR(255),
    title               VARCHAR(255) NOT NULL,
    message             TEXT         NOT NULL,
    severity            VARCHAR(24)  NOT NULL,
    flush_after         TIMESTAMPTZ  NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    consumed_at         TIMESTAMPTZ,
    CONSTRAINT notification_digest_kind_valid CHECK (kind IN (
        'alert_created','alert_updated','alert_resolved'
    )),
    CONSTRAINT notification_digest_severity_valid CHECK (severity IN (
        'info','warning','critical'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_digest_open_unique
    ON notifications.notification_digest_items (organization_id, user_id, kind, alert_id)
    WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS notification_digest_due
    ON notifications.notification_digest_items (flush_after, organization_id, user_id)
    WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION notifications.fn_user_notification_preference_resolve(
    p_organization_id VARCHAR,
    p_user_ids         VARCHAR[],
    p_channel_type     VARCHAR,
    p_severity         VARCHAR
)
RETURNS TABLE (user_id VARCHAR, delivery_mode VARCHAR)
LANGUAGE sql
AS $$
    WITH candidate_users AS (
        SELECT DISTINCT value AS user_id
        FROM UNNEST(COALESCE(p_user_ids, ARRAY[]::VARCHAR[])) AS value
        WHERE TRIM(value) <> ''
    ),
    allowed AS (
        SELECT
            c.user_id,
            LOWER(COALESCE(p.digest_preference->>'mode', 'immediate')) AS digest_mode
        FROM candidate_users c
        LEFT JOIN notifications.user_notification_preferences p
          ON p.organization_id = p_organization_id
         AND p.user_id = c.user_id
         AND p.channel_type = p_channel_type
        WHERE p.user_id IS NULL
           OR (
                p.disabled = FALSE
            AND (p.severity_filters ? p_severity)
           )
    )
    SELECT
        a.user_id,
        CASE
            WHEN a.digest_mode IN ('digest', 'hourly', 'daily', 'weekly') THEN 'digest'
            ELSE 'immediate'
        END AS delivery_mode
    FROM allowed a
    ORDER BY a.user_id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_notification_digest_queue_add_batch(
    p_organization_id     VARCHAR,
    p_user_ids             VARCHAR[],
    p_kind                 VARCHAR,
    p_alert_id             INTEGER,
    p_subject_type         VARCHAR,
    p_subject_id           VARCHAR,
    p_title                VARCHAR,
    p_message              TEXT,
    p_severity             VARCHAR,
    p_flush_after          TIMESTAMPTZ
)
RETURNS TABLE (id BIGINT, user_id VARCHAR)
LANGUAGE sql
AS $$
    INSERT INTO notifications.notification_digest_items (
        organization_id, user_id, kind, alert_id, source_subject_type,
        source_subject_id, title, message, severity, flush_after
    )
    SELECT
        p_organization_id, u.user_id, p_kind, p_alert_id, p_subject_type,
        p_subject_id, p_title, p_message, p_severity, p_flush_after
    FROM (
        SELECT DISTINCT value AS user_id
        FROM UNNEST(COALESCE(p_user_ids, ARRAY[]::VARCHAR[])) AS value
        WHERE TRIM(value) <> ''
    ) u
    ON CONFLICT (organization_id, user_id, kind, alert_id)
        WHERE consumed_at IS NULL
    DO UPDATE SET
        title = EXCLUDED.title,
        message = EXCLUDED.message,
        severity = EXCLUDED.severity,
        flush_after = LEAST(
            notifications.notification_digest_items.flush_after,
            EXCLUDED.flush_after
        )
    RETURNING id, user_id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_notification_digest_flush_due(
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    user_id         VARCHAR,
    kind            VARCHAR,
    state           VARCHAR,
    alert_id        INTEGER
)
LANGUAGE sql
AS $$
    WITH due_groups AS (
        SELECT
            organization_id,
            user_id,
            ARRAY_AGG(id ORDER BY created_at ASC) AS digest_ids,
            COUNT(*) AS item_count,
            MIN(created_at) AS first_at,
            MAX(created_at) AS last_at
        FROM notifications.notification_digest_items
        WHERE consumed_at IS NULL
          AND flush_after <= NOW()
        GROUP BY organization_id, user_id
        ORDER BY MIN(flush_after) ASC
        LIMIT GREATEST(1, COALESCE(p_limit, 100))
    ),
    marked AS (
        UPDATE notifications.notification_digest_items d
        SET consumed_at = NOW()
        FROM due_groups g
        WHERE d.id = ANY(g.digest_ids)
        RETURNING d.organization_id, d.user_id, d.id
    ),
    inserted AS (
        INSERT INTO notifications.inbox_items (
            organization_id, user_id, kind, state, alert_id,
            source_subject_type, source_subject_id, title, message,
            available_actions
        )
        SELECT
            g.organization_id,
            g.user_id,
            'alert_digest',
            'unread',
            NULL,
            NULL,
            NULL,
            'Notification digest',
            g.item_count::TEXT || ' alert notification(s) are ready.',
            jsonb_build_array(jsonb_build_object(
                'type', 'open_notifications',
                'digestIds', g.digest_ids
            ))
        FROM due_groups g
        WHERE EXISTS (
            SELECT 1
            FROM marked m
            WHERE m.organization_id = g.organization_id
              AND m.user_id = g.user_id
        )
        RETURNING id, organization_id, user_id, kind, state, alert_id
    )
    SELECT id, organization_id, user_id, kind, state, alert_id
    FROM inserted;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_notification_digest_flush_due(INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_notification_digest_queue_add_batch(
    VARCHAR, VARCHAR[], VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR, TEXT,
    VARCHAR, TIMESTAMPTZ
);
DROP FUNCTION IF EXISTS notifications.fn_user_notification_preference_resolve(
    VARCHAR, VARCHAR[], VARCHAR, VARCHAR
);
DROP TABLE IF EXISTS notifications.notification_digest_items;

ALTER TABLE notifications.inbox_items
    DROP CONSTRAINT IF EXISTS inbox_items_kind_valid;

ALTER TABLE notifications.inbox_items
    ADD CONSTRAINT inbox_items_kind_valid CHECK (kind IN (
        'alert_created','alert_updated','alert_resolved'
    ));
