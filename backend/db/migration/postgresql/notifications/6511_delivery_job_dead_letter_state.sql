--------------UP
ALTER TABLE notifications.delivery_jobs
    DROP CONSTRAINT IF EXISTS delivery_jobs_state_valid;

ALTER TABLE notifications.delivery_jobs
    ADD CONSTRAINT delivery_jobs_state_valid CHECK (state IN (
        'queued','processing','succeeded','failed','superseded','dead_letter'
    ));

DROP FUNCTION IF EXISTS notifications.fn_delivery_job_record_attempt(
    INTEGER, VARCHAR, INTEGER, VARCHAR, TEXT, BOOLEAN, INTEGER
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
        WHEN p_state = 'failed' AND p_final_failure THEN 'dead_letter'
        ELSE 'queued'
    END;

    UPDATE notifications.delivery_jobs
    SET attempt_count         = attempt_count + 1,
        state                 = v_next_state,
        processing_started_at = NULL,
        completed_at          = CASE WHEN v_next_state IN ('succeeded','dead_letter')
                                     THEN NOW() ELSE completed_at END
    WHERE id = p_job_id
    RETURNING attempt_count INTO v_count;

    IF v_next_state IN ('succeeded','dead_letter') THEN
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

DROP FUNCTION IF EXISTS notifications.fn_delivery_job_requeue(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_requeue(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id                  INTEGER,
    organization_id     VARCHAR,
    alert_id            INTEGER,
    inbox_item_id       INTEGER,
    endpoint_id         INTEGER,
    state               VARCHAR,
    created_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    attempt_count       INTEGER,
    alert_title         VARCHAR,
    alert_message       TEXT,
    alert_severity      VARCHAR,
    alert_state         VARCHAR,
    alert_rule_kind     VARCHAR,
    alert_active_since  TIMESTAMPTZ,
    alert_fired_at      TIMESTAMPTZ,
    source_subject_type VARCHAR,
    source_subject_id   VARCHAR,
    rule_id             INTEGER,
    rule_name           VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_state     VARCHAR;
    v_alert_id  INTEGER;
BEGIN
    SELECT j.state, j.alert_id INTO v_state, v_alert_id
    FROM notifications.delivery_jobs j
    WHERE j.id = p_id AND j.organization_id = p_organization_id;

    IF v_state IS NULL THEN
        RAISE EXCEPTION 'delivery_job % not found in org %', p_id, p_organization_id
            USING ERRCODE = '02000';
    END IF;
    IF v_state NOT IN ('failed', 'dead_letter') THEN
        RAISE EXCEPTION 'delivery_job % is % (only failed/dead-letter jobs can be requeued)', p_id, v_state
            USING ERRCODE = 'P0001';
    END IF;
    IF v_alert_id IS NULL THEN
        RAISE EXCEPTION 'delivery_job % cannot be requeued — backing alert was purged', p_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY
    WITH updated AS (
        UPDATE notifications.delivery_jobs
        SET state = 'queued', completed_at = NULL
        WHERE id = p_id
        RETURNING *
    )
    SELECT
        u.id, u.organization_id, u.alert_id, u.inbox_item_id, u.endpoint_id,
        u.state, u.created_at, u.completed_at, u.attempt_count,
        ai.title, ai.message, ai.severity, ai.state,
        ai.rule_kind, ai.active_since, ai.last_triggered_at,
        ai.source_subject_type, ai.source_subject_id,
        ar.id, ar.name
    FROM updated u
    JOIN notifications.alert_instances ai ON ai.id = u.alert_id
    JOIN notifications.alert_rules ar ON ar.id = ai.rule_id;
END;
$$;
--------------DOWN
ALTER TABLE notifications.delivery_jobs
    DROP CONSTRAINT IF EXISTS delivery_jobs_state_valid;

UPDATE notifications.delivery_jobs
SET state = 'failed'
WHERE state = 'dead_letter';

ALTER TABLE notifications.delivery_jobs
    ADD CONSTRAINT delivery_jobs_state_valid CHECK (state IN (
        'queued','processing','succeeded','failed','superseded'
    ));

DROP FUNCTION IF EXISTS notifications.fn_delivery_job_record_attempt(
    INTEGER, VARCHAR, INTEGER, VARCHAR, TEXT, BOOLEAN, INTEGER
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
        ELSE 'queued'
    END;

    UPDATE notifications.delivery_jobs
    SET attempt_count         = attempt_count + 1,
        state                 = v_next_state,
        processing_started_at = NULL,
        completed_at          = CASE WHEN v_next_state IN ('succeeded','failed')
                                     THEN NOW() ELSE completed_at END
    WHERE id = p_job_id
    RETURNING attempt_count INTO v_count;

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
