--------------UP
-- Single-channel lookup; the test RPC previously loaded the whole org list.
CREATE OR REPLACE FUNCTION notifications.fn_channel_get(
    p_organization_id VARCHAR,
    p_id              BIGINT
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
      AND id = p_id;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_channel_get(VARCHAR, BIGINT);
