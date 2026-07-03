--------------UP
-- Expose health + quiet-hours fields on the endpoint Get output so the
-- health card can render without a second RPC.
DROP FUNCTION IF EXISTS notifications.fn_integration_endpoint_get(VARCHAR, INTEGER);
CREATE FUNCTION notifications.fn_integration_endpoint_get(
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
    consecutive_failures  INTEGER,
    last_success_at       TIMESTAMPTZ,
    last_failure_at       TIMESTAMPTZ,
    auto_disabled_at      TIMESTAMPTZ,
    disable_reason        VARCHAR,
    quiet_hours_start     INTEGER,
    quiet_hours_end       INTEGER,
    quiet_hours_tz        VARCHAR,
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
        e.consecutive_failures, e.last_success_at, e.last_failure_at,
        e.auto_disabled_at, e.disable_reason,
        e.quiet_hours_start, e.quiet_hours_end, e.quiet_hours_tz,
        e.created_at, e.updated_at
    FROM notifications.integration_endpoints e
    LEFT JOIN notifications.integration_endpoint_secrets s
      ON s.endpoint_id = e.id
    WHERE e.organization_id = p_organization_id AND e.id = p_id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_integration_endpoint_get(VARCHAR, INTEGER);
CREATE FUNCTION notifications.fn_integration_endpoint_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, provider VARCHAR, name VARCHAR,
    enabled BOOLEAN, config JSONB, has_secret_fields BOOLEAN,
    last_test_at TIMESTAMPTZ, last_test_status VARCHAR,
    last_delivery_at TIMESTAMPTZ, last_delivery_status VARCHAR,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        e.id, e.organization_id, e.provider, e.name, e.enabled, e.config,
        (s.endpoint_id IS NOT NULL),
        e.last_test_at, e.last_test_status,
        e.last_delivery_at, e.last_delivery_status,
        e.created_at, e.updated_at
    FROM notifications.integration_endpoints e
    LEFT JOIN notifications.integration_endpoint_secrets s
      ON s.endpoint_id = e.id
    WHERE e.organization_id = p_organization_id AND e.id = p_id;
$$;
