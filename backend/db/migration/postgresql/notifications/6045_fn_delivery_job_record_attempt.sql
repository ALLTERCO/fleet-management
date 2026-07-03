--------------UP
-- Append one delivery_attempts row and move the parent delivery_jobs
-- row forward. Succeeded attempts close the job; failed attempts
-- increment attempt_count and stay 'processing' so the outbox can
-- reschedule. A caller that has exhausted retries passes
-- p_final_failure = TRUE to transition to 'failed' terminally.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_record_attempt(
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
    )
    VALUES (
        p_job_id, v_endpoint_id, p_state, p_http_status, p_provider_code,
        p_error_message
    )
    RETURNING id INTO v_attempt_id;

    v_next_state := CASE
        WHEN p_state = 'succeeded'               THEN 'succeeded'
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
--------------DOWN
DROP FUNCTION notifications.fn_delivery_job_record_attempt;
