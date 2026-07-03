--------------UP
-- Single SoT for endpoint health mutation after a delivery attempt.
-- Called by fn_delivery_job_record_attempt; surfaced via a boolean
-- return so callers know whether auto-disable was triggered and can
-- emit a WS event.
CREATE OR REPLACE FUNCTION notifications.fn_endpoint_record_delivery(
    p_endpoint_id       INTEGER,
    p_state             VARCHAR,
    p_autooff_threshold INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_auto_disabled BOOLEAN := FALSE;
BEGIN
    IF p_state = 'succeeded' THEN
        UPDATE notifications.integration_endpoints
        SET last_delivery_at     = NOW(),
            last_delivery_status = 'success',
            last_success_at      = NOW(),
            consecutive_failures = 0,
            auto_disabled_at     = NULL,
            disable_reason       = NULL,
            updated_at           = NOW()
        WHERE id = p_endpoint_id;
    ELSIF p_state = 'failed' THEN
        UPDATE notifications.integration_endpoints
        SET last_delivery_at     = NOW(),
            last_delivery_status = 'failed',
            last_failure_at      = NOW(),
            consecutive_failures = consecutive_failures + 1,
            updated_at           = NOW()
        WHERE id = p_endpoint_id
        RETURNING consecutive_failures >= p_autooff_threshold
              AND auto_disabled_at IS NULL
        INTO v_auto_disabled;

        IF v_auto_disabled THEN
            UPDATE notifications.integration_endpoints
            SET auto_disabled_at = NOW(),
                disable_reason   = format(
                    '%s consecutive delivery failures',
                    p_autooff_threshold
                ),
                enabled          = FALSE
            WHERE id = p_endpoint_id;
        END IF;
    END IF;

    RETURN COALESCE(v_auto_disabled, FALSE);
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_endpoint_record_delivery(INTEGER, VARCHAR, INTEGER);
