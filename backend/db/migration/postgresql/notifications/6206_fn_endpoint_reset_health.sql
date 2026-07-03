--------------UP
-- Operator-initiated recovery after auto-disable: clears the failure
-- counter + disabled state and (optionally) re-enables the endpoint.
CREATE OR REPLACE FUNCTION notifications.fn_endpoint_reset_health(
    p_id              INTEGER,
    p_organization_id VARCHAR,
    p_re_enable       BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    UPDATE notifications.integration_endpoints
    SET consecutive_failures = 0,
        auto_disabled_at     = NULL,
        disable_reason       = NULL,
        enabled              = CASE WHEN p_re_enable THEN TRUE ELSE enabled END,
        updated_at           = NOW()
    WHERE id = p_id AND organization_id = p_organization_id
    RETURNING TRUE;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_endpoint_reset_health(INTEGER, VARCHAR, BOOLEAN);
