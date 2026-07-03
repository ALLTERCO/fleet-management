--------------UP
-- Next instant (UTC) an endpoint's quiet-hours window ends, or NULL if the
-- endpoint has no quiet hours. Lets the outbox worker reschedule a suppressed
-- delivery for exactly when the window lifts instead of burning retry budget.
CREATE OR REPLACE FUNCTION notifications.fn_endpoint_quiet_hours_until(
    p_endpoint_id INTEGER
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_end       INTEGER;
    v_tz        VARCHAR;
    v_now_local TIMESTAMP;
    v_end_local TIMESTAMP;
BEGIN
    SELECT quiet_hours_end, quiet_hours_tz
      INTO v_end, v_tz
      FROM notifications.integration_endpoints
     WHERE id = p_endpoint_id;

    IF v_end IS NULL OR v_tz IS NULL THEN
        RETURN NULL;
    END IF;

    v_now_local := NOW() AT TIME ZONE v_tz;
    v_end_local := date_trunc('day', v_now_local)
                   + make_interval(hours => v_end);
    -- Already past today's end hour → the window ends tomorrow.
    IF v_end_local <= v_now_local THEN
        v_end_local := v_end_local + INTERVAL '1 day';
    END IF;

    RETURN v_end_local AT TIME ZONE v_tz;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_endpoint_quiet_hours_until(INTEGER);
