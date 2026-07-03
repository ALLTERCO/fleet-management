--------------UP
DROP FUNCTION IF EXISTS notifications.fn_channel_upsert(
    VARCHAR, BIGINT, VARCHAR, VARCHAR, JSONB
);

CREATE OR REPLACE FUNCTION notifications.fn_channel_upsert(
    p_organization_id         VARCHAR,
    p_channel_id              BIGINT DEFAULT NULL,
    p_name                    VARCHAR DEFAULT NULL,
    p_type                    VARCHAR DEFAULT NULL,
    p_config                  JSONB DEFAULT '{}'::jsonb,
    p_integration_endpoint_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id                      BIGINT,
    organization_id         VARCHAR,
    integration_endpoint_id INTEGER,
    name                    VARCHAR,
    type                    VARCHAR,
    config                  JSONB,
    secret_version          INTEGER,
    verification_status     VARCHAR,
    disabled_reason         VARCHAR,
    last_delivery_status    VARCHAR,
    last_delivery_at        TIMESTAMPTZ,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_integration_endpoint_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM notifications.integration_endpoints e
        WHERE e.id = p_integration_endpoint_id
          AND e.organization_id = p_organization_id
          AND e.provider = p_type
    ) THEN
        RAISE foreign_key_violation USING MESSAGE = 'integration endpoint not found for channel';
    END IF;

    IF p_channel_id IS NOT NULL THEN
        RETURN QUERY
        UPDATE notifications.channels
        SET
            integration_endpoint_id = p_integration_endpoint_id,
            name                    = COALESCE(p_name, channels.name),
            type                    = COALESCE(p_type, channels.type),
            config                  = COALESCE(p_config, channels.config),
            updated_at              = NOW()
        WHERE organization_id = p_organization_id
          AND id = p_channel_id
        RETURNING
            channels.id,
            channels.organization_id,
            channels.integration_endpoint_id,
            channels.name,
            channels.type,
            channels.config,
            channels.secret_version,
            channels.verification_status,
            channels.disabled_reason,
            channels.last_delivery_status,
            channels.last_delivery_at,
            channels.created_at,
            channels.updated_at;
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO notifications.channels (
        organization_id,
        integration_endpoint_id,
        name,
        type,
        config,
        updated_at
    )
    VALUES (
        p_organization_id,
        p_integration_endpoint_id,
        p_name,
        p_type,
        COALESCE(p_config, '{}'::jsonb),
        NOW()
    )
    RETURNING
        channels.id,
        channels.organization_id,
        channels.integration_endpoint_id,
        channels.name,
        channels.type,
        channels.config,
        channels.secret_version,
        channels.verification_status,
        channels.disabled_reason,
        channels.last_delivery_status,
        channels.last_delivery_at,
        channels.created_at,
        channels.updated_at;
END;
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

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_create_for_contact_points(
    VARCHAR, INTEGER[], INTEGER[], INTEGER, INTEGER
);
DROP FUNCTION IF EXISTS notifications.fn_channel_upsert(
    VARCHAR, BIGINT, VARCHAR, VARCHAR, JSONB, INTEGER
);
