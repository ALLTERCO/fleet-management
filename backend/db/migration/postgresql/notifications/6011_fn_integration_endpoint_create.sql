--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_integration_endpoint_create(
    p_organization_id VARCHAR,
    p_provider        VARCHAR,
    p_name            VARCHAR,
    p_enabled         BOOLEAN DEFAULT TRUE,
    p_config          JSONB DEFAULT '{}'::jsonb
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
    PERFORM organization.fn_profile_ensure(p_organization_id);

    RETURN QUERY
    WITH inserted AS (
        INSERT INTO notifications.integration_endpoints (
            organization_id, provider, name, enabled, config
        )
        VALUES (
            p_organization_id,
            p_provider,
            p_name,
            COALESCE(p_enabled, TRUE),
            COALESCE(p_config, '{}'::jsonb)
        )
        RETURNING *
    )
    SELECT
        i.id, i.organization_id, i.provider, i.name, i.enabled, i.config,
        FALSE AS has_secret_fields,
        i.last_test_at, i.last_test_status,
        i.last_delivery_at, i.last_delivery_status,
        i.created_at, i.updated_at
    FROM inserted i;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_integration_endpoint_create;
