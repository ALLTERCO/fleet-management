--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_channel_list(
    p_organization_id VARCHAR,
    p_type            VARCHAR DEFAULT NULL
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
LANGUAGE sql
AS $$
    SELECT
        id,
        organization_id,
        integration_endpoint_id,
        name,
        type,
        config,
        secret_version,
        verification_status,
        disabled_reason,
        last_delivery_status,
        last_delivery_at,
        created_at,
        updated_at
    FROM notifications.channels
    WHERE organization_id = p_organization_id
      AND (p_type IS NULL OR type = p_type)
    ORDER BY LOWER(name), id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_channel_upsert(
    p_organization_id VARCHAR,
    p_channel_id      BIGINT DEFAULT NULL,
    p_name            VARCHAR DEFAULT NULL,
    p_type            VARCHAR DEFAULT NULL,
    p_config          JSONB DEFAULT '{}'::jsonb
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
    IF p_channel_id IS NOT NULL THEN
        RETURN QUERY
        UPDATE notifications.channels
        SET
            name       = COALESCE(p_name, channels.name),
            type       = COALESCE(p_type, channels.type),
            config     = COALESCE(p_config, channels.config),
            updated_at = NOW()
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
        name,
        type,
        config,
        updated_at
    )
    VALUES (
        p_organization_id,
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

CREATE OR REPLACE FUNCTION notifications.fn_channel_delete(
    p_organization_id VARCHAR,
    p_channel_id      BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH deleted AS (
        DELETE FROM notifications.channels
        WHERE organization_id = p_organization_id
          AND id = p_channel_id
        RETURNING id
    )
    SELECT EXISTS (SELECT 1 FROM deleted);
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_channel_delete(VARCHAR, BIGINT);
DROP FUNCTION IF EXISTS notifications.fn_channel_upsert(
    VARCHAR, BIGINT, VARCHAR, VARCHAR, JSONB
);
DROP FUNCTION IF EXISTS notifications.fn_channel_list(VARCHAR, VARCHAR);
