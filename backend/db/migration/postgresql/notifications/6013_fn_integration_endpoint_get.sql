--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_integration_endpoint_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
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
LANGUAGE sql
AS $$
    SELECT
        e.id, e.organization_id, e.provider, e.name, e.enabled, e.config,
        (s.endpoint_id IS NOT NULL) AS has_secret_fields,
        e.last_test_at, e.last_test_status,
        e.last_delivery_at, e.last_delivery_status,
        e.created_at, e.updated_at
    FROM notifications.integration_endpoints e
    LEFT JOIN notifications.integration_endpoint_secrets s
      ON s.endpoint_id = e.id
    WHERE e.organization_id = p_organization_id
      AND e.id = p_id;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_integration_endpoint_get;
