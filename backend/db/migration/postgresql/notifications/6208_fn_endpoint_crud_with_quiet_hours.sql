--------------UP
-- Create + Update now accept quiet-hours fields (all optional). Return
-- the same health-bearing shape as fn_integration_endpoint_get so a
-- single rowToEndpoint helper can consume every endpoint RPC.
DROP FUNCTION IF EXISTS notifications.fn_integration_endpoint_create(
    VARCHAR, VARCHAR, VARCHAR, BOOLEAN, JSONB);
CREATE FUNCTION notifications.fn_integration_endpoint_create(
    p_organization_id     VARCHAR,
    p_provider            VARCHAR,
    p_name                VARCHAR,
    p_enabled             BOOLEAN DEFAULT TRUE,
    p_config              JSONB   DEFAULT '{}'::jsonb,
    p_quiet_hours_start   INTEGER DEFAULT NULL,
    p_quiet_hours_end     INTEGER DEFAULT NULL,
    p_quiet_hours_tz      VARCHAR DEFAULT 'UTC'
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
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    RETURN QUERY
    WITH inserted AS (
        INSERT INTO notifications.integration_endpoints (
            organization_id, provider, name, enabled, config,
            quiet_hours_start, quiet_hours_end, quiet_hours_tz
        )
        VALUES (
            p_organization_id, p_provider, p_name,
            COALESCE(p_enabled, TRUE), COALESCE(p_config, '{}'::jsonb),
            p_quiet_hours_start, p_quiet_hours_end,
            COALESCE(p_quiet_hours_tz, 'UTC')
        )
        RETURNING *
    )
    SELECT
        i.id, i.organization_id, i.provider, i.name, i.enabled, i.config,
        FALSE AS has_secret_fields,
        i.last_test_at, i.last_test_status,
        i.last_delivery_at, i.last_delivery_status,
        i.consecutive_failures, i.last_success_at, i.last_failure_at,
        i.auto_disabled_at, i.disable_reason,
        i.quiet_hours_start, i.quiet_hours_end, i.quiet_hours_tz,
        i.created_at, i.updated_at
    FROM inserted i;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_integration_endpoint_update(
    VARCHAR, INTEGER, VARCHAR, BOOLEAN, JSONB);
CREATE FUNCTION notifications.fn_integration_endpoint_update(
    p_organization_id     VARCHAR,
    p_id                  INTEGER,
    p_name                VARCHAR DEFAULT NULL,
    p_enabled             BOOLEAN DEFAULT NULL,
    p_config              JSONB   DEFAULT NULL,
    p_quiet_hours_start   INTEGER DEFAULT NULL,
    p_quiet_hours_end     INTEGER DEFAULT NULL,
    p_quiet_hours_tz      VARCHAR DEFAULT NULL,
    p_clear_quiet_hours   BOOLEAN DEFAULT FALSE
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
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH updated AS (
        UPDATE notifications.integration_endpoints e
        SET
            name               = COALESCE(p_name, e.name),
            enabled            = COALESCE(p_enabled, e.enabled),
            config             = COALESCE(p_config, e.config),
            quiet_hours_start  = CASE WHEN p_clear_quiet_hours THEN NULL
                                      ELSE COALESCE(p_quiet_hours_start, e.quiet_hours_start) END,
            quiet_hours_end    = CASE WHEN p_clear_quiet_hours THEN NULL
                                      ELSE COALESCE(p_quiet_hours_end, e.quiet_hours_end) END,
            quiet_hours_tz     = COALESCE(p_quiet_hours_tz, e.quiet_hours_tz),
            updated_at         = NOW()
        WHERE e.id = p_id AND e.organization_id = p_organization_id
        RETURNING e.*
    )
    SELECT
        u.id, u.organization_id, u.provider, u.name, u.enabled, u.config,
        EXISTS (
            SELECT 1 FROM notifications.integration_endpoint_secrets s
            WHERE s.endpoint_id = u.id
        ) AS has_secret_fields,
        u.last_test_at, u.last_test_status,
        u.last_delivery_at, u.last_delivery_status,
        u.consecutive_failures, u.last_success_at, u.last_failure_at,
        u.auto_disabled_at, u.disable_reason,
        u.quiet_hours_start, u.quiet_hours_end, u.quiet_hours_tz,
        u.created_at, u.updated_at
    FROM updated u;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_integration_endpoint_create(
    VARCHAR, VARCHAR, VARCHAR, BOOLEAN, JSONB, INTEGER, INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS notifications.fn_integration_endpoint_update(
    VARCHAR, INTEGER, VARCHAR, BOOLEAN, JSONB, INTEGER, INTEGER, VARCHAR, BOOLEAN);
-- Re-create the thin (pre-health) signatures so the rollback restores
-- the API shape the old TS wrapper expected. Health columns on the
-- table are left behind intentionally — they don't break old code.
CREATE FUNCTION notifications.fn_integration_endpoint_create(
    p_organization_id VARCHAR,
    p_provider        VARCHAR,
    p_name            VARCHAR,
    p_enabled         BOOLEAN DEFAULT TRUE,
    p_config          JSONB   DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, provider VARCHAR, name VARCHAR,
    enabled BOOLEAN, config JSONB, has_secret_fields BOOLEAN,
    last_test_at TIMESTAMPTZ, last_test_status VARCHAR,
    last_delivery_at TIMESTAMPTZ, last_delivery_status VARCHAR,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    RETURN QUERY
    WITH inserted AS (
        INSERT INTO notifications.integration_endpoints (
            organization_id, provider, name, enabled, config
        ) VALUES (
            p_organization_id, p_provider, p_name,
            COALESCE(p_enabled, TRUE), COALESCE(p_config, '{}'::jsonb)
        ) RETURNING *
    )
    SELECT i.id, i.organization_id, i.provider, i.name, i.enabled, i.config,
        FALSE, i.last_test_at, i.last_test_status, i.last_delivery_at,
        i.last_delivery_status, i.created_at, i.updated_at
    FROM inserted i;
END;
$$;
CREATE FUNCTION notifications.fn_integration_endpoint_update(
    p_organization_id VARCHAR, p_id INTEGER, p_name VARCHAR DEFAULT NULL,
    p_enabled BOOLEAN DEFAULT NULL, p_config JSONB DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER, organization_id VARCHAR, provider VARCHAR, name VARCHAR,
    enabled BOOLEAN, config JSONB, has_secret_fields BOOLEAN,
    last_test_at TIMESTAMPTZ, last_test_status VARCHAR,
    last_delivery_at TIMESTAMPTZ, last_delivery_status VARCHAR,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH updated AS (
        UPDATE notifications.integration_endpoints e SET
            name = COALESCE(p_name, e.name),
            enabled = COALESCE(p_enabled, e.enabled),
            config = COALESCE(p_config, e.config),
            updated_at = NOW()
        WHERE e.id = p_id AND e.organization_id = p_organization_id
        RETURNING e.*
    )
    SELECT u.id, u.organization_id, u.provider, u.name, u.enabled, u.config,
        EXISTS(SELECT 1 FROM notifications.integration_endpoint_secrets s WHERE s.endpoint_id = u.id),
        u.last_test_at, u.last_test_status, u.last_delivery_at,
        u.last_delivery_status, u.created_at, u.updated_at
    FROM updated u;
END;
$$;
