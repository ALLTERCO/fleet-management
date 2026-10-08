--------------UP
-- Channel.Test with dryRun=false sends through the same provider path as a real
-- alert, but never recorded the outcome, so "Last delivery" stayed empty on a
-- channel that had just delivered. Record it through this function — the one
-- home for "a send happened to this channel" — rather than writing the columns
-- from a second place.
--
-- Auto-off must not fire on manual tests: the counter exists to stop the outbox
-- hammering a dead endpoint, and a person testing a broken channel ten times
-- while fixing it is the opposite of that. Successful sends still clear the
-- counter, because a send that worked is real evidence the channel is healthy.
-- Adding a parameter creates an overload rather than replacing, so the 3-arg
-- version must go. Existing 3-arg callers still resolve here via the default.
DROP FUNCTION IF EXISTS notifications.fn_channel_record_delivery(INTEGER, VARCHAR, INTEGER);

CREATE OR REPLACE FUNCTION notifications.fn_channel_record_delivery(
    p_endpoint_id          INTEGER,
    p_status               VARCHAR,
    p_autooff_threshold    INTEGER DEFAULT 10,
    p_count_toward_autooff BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_auto_disabled BOOLEAN := FALSE;
BEGIN
    IF p_status = 'succeeded' THEN
        UPDATE notifications.channels
        SET last_delivery_at = NOW(),
            last_delivery_status = 'success',
            last_success_at = NOW(),
            consecutive_failures = 0,
            auto_disabled_at = NULL,
            disable_reason = NULL,
            updated_at = NOW()
        WHERE id = p_endpoint_id;
        RETURN FALSE;
    END IF;

    IF NOT p_count_toward_autooff THEN
        UPDATE notifications.channels
        SET last_delivery_at = NOW(),
            last_delivery_status = 'failed',
            last_failure_at = NOW(),
            updated_at = NOW()
        WHERE id = p_endpoint_id;
        RETURN FALSE;
    END IF;

    UPDATE notifications.channels
    SET last_delivery_at = NOW(),
        last_delivery_status = 'failed',
        last_failure_at = NOW(),
        consecutive_failures = consecutive_failures + 1,
        auto_disabled_at = CASE
            WHEN consecutive_failures + 1 >= p_autooff_threshold THEN COALESCE(auto_disabled_at, NOW())
            ELSE auto_disabled_at
        END,
        disable_reason = CASE
            WHEN consecutive_failures + 1 >= p_autooff_threshold THEN 'too_many_failures'
            ELSE disable_reason
        END,
        enabled = CASE
            WHEN consecutive_failures + 1 >= p_autooff_threshold THEN FALSE
            ELSE enabled
        END,
        updated_at = NOW()
    WHERE id = p_endpoint_id
    RETURNING auto_disabled_at IS NOT NULL INTO v_auto_disabled;

    RETURN COALESCE(v_auto_disabled, FALSE);
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_channel_record_delivery(INTEGER, VARCHAR, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION notifications.fn_channel_record_delivery(
    p_endpoint_id       INTEGER,
    p_status            VARCHAR,
    p_autooff_threshold INTEGER DEFAULT 10
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_auto_disabled BOOLEAN := FALSE;
BEGIN
    IF p_status = 'succeeded' THEN
        UPDATE notifications.channels
        SET last_delivery_at = NOW(),
            last_delivery_status = 'success',
            last_success_at = NOW(),
            consecutive_failures = 0,
            auto_disabled_at = NULL,
            disable_reason = NULL,
            updated_at = NOW()
        WHERE id = p_endpoint_id;
    ELSE
        UPDATE notifications.channels
        SET last_delivery_at = NOW(),
            last_delivery_status = 'failed',
            last_failure_at = NOW(),
            consecutive_failures = consecutive_failures + 1,
            auto_disabled_at = CASE
                WHEN consecutive_failures + 1 >= p_autooff_threshold THEN COALESCE(auto_disabled_at, NOW())
                ELSE auto_disabled_at
            END,
            disable_reason = CASE
                WHEN consecutive_failures + 1 >= p_autooff_threshold THEN 'too_many_failures'
                ELSE disable_reason
            END,
            enabled = CASE
                WHEN consecutive_failures + 1 >= p_autooff_threshold THEN FALSE
                ELSE enabled
            END,
            updated_at = NOW()
        WHERE id = p_endpoint_id
        RETURNING auto_disabled_at IS NOT NULL INTO v_auto_disabled;
    END IF;
    RETURN COALESCE(v_auto_disabled, FALSE);
END;
$$;
