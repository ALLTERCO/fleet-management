--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_integration_endpoint_update(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_name            VARCHAR DEFAULT NULL,
    p_enabled         BOOLEAN DEFAULT NULL,
    p_config          JSONB DEFAULT NULL
)
RETURNS TABLE (
    id                    INTEGER,
    organization_id       VARCHAR,
    provider              VARCHAR,
    name                  VARCHAR,
    enabled               BOOLEAN,
    config                JSONB,
    has_secret_fields     BOOLEAN,
    last_test_at          TIMESTAMPTZ,
    last_test_status      VARCHAR,
    last_delivery_at      TIMESTAMPTZ,
    last_delivery_status  VARCHAR,
    created_at            TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH updated AS (
        UPDATE notifications.integration_endpoints e
        SET
            name = COALESCE(p_name, e.name),
            enabled = COALESCE(p_enabled, e.enabled),
            config = COALESCE(p_config, e.config),
            updated_at = NOW()
        WHERE e.id = p_id
          AND e.organization_id = p_organization_id
        RETURNING e.*
    )
    SELECT
        u.id, u.organization_id, u.provider, u.name, u.enabled, u.config,
        EXISTS (
            SELECT 1
            FROM notifications.integration_endpoint_secrets s
            WHERE s.endpoint_id = u.id
        ) AS has_secret_fields,
        u.last_test_at, u.last_test_status,
        u.last_delivery_at, u.last_delivery_status,
        u.created_at, u.updated_at
    FROM updated u;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_integration_endpoint_update;
