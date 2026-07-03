--------------UP
-- Returns the provider_code (e.g. Telegram message_id, SMTP Message-Id)
-- of the most recent succeeded delivery attempt for a given alert on a
-- given endpoint. Used by the outbox so stateful adapters can edit the
-- original message in place when an alert transitions state, instead of
-- sending a fresh message.

CREATE OR REPLACE FUNCTION notifications.fn_delivery_last_success_for_alert(
    p_organization_id VARCHAR,
    p_alert_id        INTEGER,
    p_endpoint_id     INTEGER
)
RETURNS VARCHAR
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_code VARCHAR;
BEGIN
    SELECT a.provider_code
    INTO v_code
    FROM notifications.delivery_attempts a
    JOIN notifications.delivery_jobs j ON j.id = a.job_id
    WHERE j.organization_id = p_organization_id
      AND j.alert_id = p_alert_id
      AND a.endpoint_id = p_endpoint_id
      AND a.state = 'succeeded'
      AND a.provider_code IS NOT NULL
    ORDER BY a.attempted_at DESC
    LIMIT 1;
    RETURN v_code;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_delivery_last_success_for_alert(
    VARCHAR, INTEGER, INTEGER
);
