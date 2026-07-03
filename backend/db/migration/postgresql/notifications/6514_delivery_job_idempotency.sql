--------------UP
ALTER TABLE notifications.delivery_jobs
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(240);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_jobs_org_idempotency_key_unique
    ON notifications.delivery_jobs (organization_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_create_batch(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_alert_id        INTEGER,
    p_inbox_item_id   INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id          INTEGER,
    endpoint_id INTEGER,
    provider    VARCHAR
)
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
            p_organization_id,
            p_alert_id,
            p_inbox_item_id,
            e.endpoint_id,
            'queued',
            e.idempotency_key
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
    WITH group_endpoints AS (
        SELECT DISTINCT e.id AS endpoint_id, e.provider
        FROM notifications.destination_groups dg
        JOIN notifications.destination_group_members m
          ON m.destination_group_id = dg.id
         AND m.member_type = 'integration_endpoint'
         AND m.member_id ~ '^[0-9]+$'
        JOIN notifications.integration_endpoints e
          ON e.id = m.member_id::INTEGER
         AND e.organization_id = p_organization_id
         AND e.enabled = TRUE
        WHERE dg.organization_id = p_organization_id
          AND dg.enabled = TRUE
          AND dg.id = ANY(COALESCE(p_destination_group_ids, ARRAY[]::INTEGER[]))
    ),
    channel_endpoints AS (
        SELECT DISTINCT e.id AS endpoint_id, e.provider
        FROM notifications.channels c
        JOIN notifications.integration_endpoints e
          ON e.id = c.integration_endpoint_id
         AND e.organization_id = p_organization_id
         AND e.enabled = TRUE
        WHERE c.organization_id = p_organization_id
          AND c.id = ANY(COALESCE(p_channel_ids, ARRAY[]::INTEGER[]))
          AND c.integration_endpoint_id IS NOT NULL
          AND c.disabled_reason IS NULL
    ),
    endpoints AS (
        SELECT
            endpoint_id,
            provider,
            FORMAT(
                'alert:%s:inbox:%s:endpoint:%s',
                p_alert_id,
                COALESCE(p_inbox_item_id, 0),
                endpoint_id
            ) AS idempotency_key
        FROM (
            SELECT endpoint_id, provider FROM group_endpoints
            UNION
            SELECT endpoint_id, provider FROM channel_endpoints
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
            e.endpoint_id,
            'queued',
            e.idempotency_key
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

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_create_batch(
    VARCHAR, INTEGER, INTEGER, INTEGER
);
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_create_for_contact_points(
    VARCHAR, INTEGER[], INTEGER[], INTEGER, INTEGER
);

DROP INDEX IF EXISTS notifications.delivery_jobs_org_idempotency_key_unique;

ALTER TABLE notifications.delivery_jobs
    DROP COLUMN IF EXISTS idempotency_key;

CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_create_batch(
    p_organization_id VARCHAR,
    p_rule_id         INTEGER,
    p_alert_id        INTEGER,
    p_inbox_item_id   INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id          INTEGER,
    endpoint_id INTEGER,
    provider    VARCHAR
)
LANGUAGE sql
AS $$
    WITH endpoints AS (
        SELECT DISTINCT e.id AS endpoint_id, e.provider
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
            organization_id, alert_id, inbox_item_id, endpoint_id, state
        )
        SELECT
            p_organization_id,
            p_alert_id,
            p_inbox_item_id,
            e.endpoint_id,
            'queued'
        FROM endpoints e
        RETURNING id, endpoint_id
    )
    SELECT
        i.id,
        i.endpoint_id,
        e.provider
    FROM inserted i
    JOIN notifications.integration_endpoints e ON e.id = i.endpoint_id;
$$;

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
    WITH group_endpoints AS (
        SELECT DISTINCT e.id AS endpoint_id, e.provider
        FROM notifications.destination_groups dg
        JOIN notifications.destination_group_members m
          ON m.destination_group_id = dg.id
         AND m.member_type = 'integration_endpoint'
         AND m.member_id ~ '^[0-9]+$'
        JOIN notifications.integration_endpoints e
          ON e.id = m.member_id::INTEGER
         AND e.organization_id = p_organization_id
         AND e.enabled = TRUE
        WHERE dg.organization_id = p_organization_id
          AND dg.enabled = TRUE
          AND dg.id = ANY(COALESCE(p_destination_group_ids, ARRAY[]::INTEGER[]))
    ),
    channel_endpoints AS (
        SELECT DISTINCT e.id AS endpoint_id, e.provider
        FROM notifications.channels c
        JOIN notifications.integration_endpoints e
          ON e.id = c.integration_endpoint_id
         AND e.organization_id = p_organization_id
         AND e.enabled = TRUE
        WHERE c.organization_id = p_organization_id
          AND c.id = ANY(COALESCE(p_channel_ids, ARRAY[]::INTEGER[]))
          AND c.integration_endpoint_id IS NOT NULL
          AND c.disabled_reason IS NULL
    ),
    endpoints AS (
        SELECT endpoint_id, provider FROM group_endpoints
        UNION
        SELECT endpoint_id, provider FROM channel_endpoints
    ),
    inserted AS (
        INSERT INTO notifications.delivery_jobs (
            organization_id, alert_id, inbox_item_id, endpoint_id, state
        )
        SELECT
            p_organization_id,
            p_alert_id,
            p_inbox_item_id,
            e.endpoint_id,
            'queued'
        FROM endpoints e
        RETURNING id, endpoint_id
    )
    SELECT
        i.id,
        i.endpoint_id,
        e.provider
    FROM inserted i
    JOIN notifications.integration_endpoints e ON e.id = i.endpoint_id;
$$;
