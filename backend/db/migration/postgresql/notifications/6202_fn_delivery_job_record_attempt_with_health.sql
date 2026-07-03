--------------UP
-- Extend record_attempt to drive endpoint health via fn_endpoint_record_delivery.
-- p_autooff_threshold is passed through from FM_ENDPOINT_AUTOOFF_THRESHOLD;
-- returning auto_disabled lets the backend emit a WS event on transition.
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_record_attempt(
    INTEGER, VARCHAR, INTEGER, VARCHAR, TEXT, BOOLEAN
);
CREATE FUNCTION notifications.fn_delivery_job_record_attempt(
    p_job_id            INTEGER,
    p_state             VARCHAR,
    p_http_status       INTEGER DEFAULT NULL,
    p_provider_code     VARCHAR DEFAULT NULL,
    p_error_message     TEXT    DEFAULT NULL,
    p_final_failure     BOOLEAN DEFAULT FALSE,
    p_autooff_threshold INTEGER DEFAULT 10
)
RETURNS TABLE (
    job_id          INTEGER,
    attempt_id      INTEGER,
    job_state       VARCHAR,
    attempt_count   INTEGER,
    endpoint_id     INTEGER,
    auto_disabled   BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_endpoint_id   INTEGER;
    v_attempt_id    INTEGER;
    v_next_state    VARCHAR;
    v_count         INTEGER;
    v_auto_disabled BOOLEAN := FALSE;
BEGIN
    SELECT endpoint_id INTO v_endpoint_id
    FROM notifications.delivery_jobs
    WHERE id = p_job_id;
    IF v_endpoint_id IS NULL THEN
        RAISE EXCEPTION 'delivery_job % not found', p_job_id
            USING ERRCODE = '02000';
    END IF;

    INSERT INTO notifications.delivery_attempts (
        job_id, endpoint_id, state, http_status, provider_code, error_message
    )
    VALUES (
        p_job_id, v_endpoint_id, p_state, p_http_status, p_provider_code,
        p_error_message
    )
    RETURNING id INTO v_attempt_id;

    v_next_state := CASE
        WHEN p_state = 'succeeded'                  THEN 'succeeded'
        WHEN p_state = 'failed' AND p_final_failure THEN 'failed'
        ELSE 'processing'
    END;

    UPDATE notifications.delivery_jobs
    SET attempt_count = attempt_count + 1,
        state         = v_next_state,
        completed_at  = CASE WHEN v_next_state IN ('succeeded','failed')
                             THEN NOW() ELSE completed_at END
    WHERE id = p_job_id
    RETURNING attempt_count INTO v_count;

    -- Only mutate endpoint health on terminal transitions so mid-retry
    -- failures don't flip the counter.
    IF v_next_state IN ('succeeded','failed') THEN
        v_auto_disabled := notifications.fn_endpoint_record_delivery(
            v_endpoint_id,
            CASE WHEN v_next_state = 'succeeded' THEN 'succeeded' ELSE 'failed' END,
            p_autooff_threshold
        );
    END IF;

    RETURN QUERY SELECT
        p_job_id, v_attempt_id, v_next_state, v_count,
        v_endpoint_id, v_auto_disabled;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_record_attempt(
    INTEGER, VARCHAR, INTEGER, VARCHAR, TEXT, BOOLEAN, INTEGER
);
CREATE FUNCTION notifications.fn_delivery_job_record_attempt(
    p_job_id        INTEGER,
    p_state         VARCHAR,
    p_http_status   INTEGER DEFAULT NULL,
    p_provider_code VARCHAR DEFAULT NULL,
    p_error_message TEXT    DEFAULT NULL,
    p_final_failure BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    job_id       INTEGER,
    attempt_id   INTEGER,
    job_state    VARCHAR,
    attempt_count INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_endpoint_id INTEGER;
    v_attempt_id  INTEGER;
    v_next_state  VARCHAR;
    v_count       INTEGER;
BEGIN
    SELECT endpoint_id INTO v_endpoint_id
    FROM notifications.delivery_jobs
    WHERE id = p_job_id;
    IF v_endpoint_id IS NULL THEN
        RAISE EXCEPTION 'delivery_job % not found', p_job_id
            USING ERRCODE = '02000';
    END IF;
    INSERT INTO notifications.delivery_attempts (
        job_id, endpoint_id, state, http_status, provider_code, error_message
    ) VALUES (
        p_job_id, v_endpoint_id, p_state, p_http_status, p_provider_code,
        p_error_message
    ) RETURNING id INTO v_attempt_id;
    v_next_state := CASE
        WHEN p_state = 'succeeded'                  THEN 'succeeded'
        WHEN p_state = 'failed' AND p_final_failure THEN 'failed'
        ELSE 'processing'
    END;
    UPDATE notifications.delivery_jobs
    SET attempt_count = attempt_count + 1,
        state         = v_next_state,
        completed_at  = CASE WHEN v_next_state IN ('succeeded','failed')
                             THEN NOW() ELSE completed_at END
    WHERE id = p_job_id
    RETURNING attempt_count INTO v_count;
    RETURN QUERY SELECT p_job_id, v_attempt_id, v_next_state, v_count;
END;
$$;
