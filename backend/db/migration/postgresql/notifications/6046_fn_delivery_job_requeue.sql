--------------UP
-- Admin retry for failed delivery jobs. Returns updated job + alert
-- fields so the caller can rebuild the DeliveryPayload in one round-trip.
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
    alert_rule_kind     VARCHAR,
    source_subject_type VARCHAR,
    source_subject_id   VARCHAR
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
    IF v_state <> 'failed' THEN
        RAISE EXCEPTION 'delivery_job % is % (only failed jobs can be requeued)', p_id, v_state
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
        ai.title, ai.message, ai.severity, ai.rule_kind,
        ai.source_subject_type, ai.source_subject_id
    FROM updated u
    JOIN notifications.alert_instances ai ON ai.id = u.alert_id;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_delivery_job_requeue;
