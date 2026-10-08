--------------UP
-- Bounded operational history for Grafana's report-capacity alerts. These
-- rows contain instance-level counts and timings only; no tenant, report,
-- device, or user identifiers are stored.
CREATE TABLE IF NOT EXISTS logging.report_performance_observation (
    id BIGSERIAL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    kind TEXT NOT NULL,
    queued_count INTEGER,
    processing_count INTEGER,
    worker_capacity INTEGER,
    oldest_queued_age_ms BIGINT,
    saturated BOOLEAN,
    duration_ms BIGINT,
    budget_ms BIGINT,
    complex_rows INTEGER,
    failed BOOLEAN,
    PRIMARY KEY (id, observed_at),
    CONSTRAINT report_performance_kind_valid
        CHECK (kind IN (
            'worker_snapshot', 'pdf_render', 'pdf_persist_failure'
        )),
    CONSTRAINT report_performance_worker_values_valid CHECK (
        kind <> 'worker_snapshot' OR (
            queued_count >= 0 AND processing_count >= 0
            AND worker_capacity > 0 AND oldest_queued_age_ms >= 0
            AND saturated IS NOT NULL
        )
    ),
    CONSTRAINT report_performance_pdf_values_valid CHECK (
        kind <> 'pdf_render' OR (
            duration_ms >= 0 AND budget_ms > 0 AND complex_rows >= 0
            AND failed IS NOT NULL
        )
    )
);

CREATE INDEX IF NOT EXISTS report_performance_kind_time_idx
    ON logging.report_performance_observation (kind, observed_at DESC);

SELECT create_hypertable(
    'logging.report_performance_observation',
    'observed_at',
    if_not_exists => TRUE
);
SELECT add_retention_policy(
    'logging.report_performance_observation',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

CREATE OR REPLACE FUNCTION logging.fn_report_worker_observation_add(
    p_queued_count INTEGER,
    p_report_processing_count INTEGER,
    p_worker_occupied_count INTEGER,
    p_worker_capacity INTEGER,
    p_oldest_queued_age_ms BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO logging.report_performance_observation (
        kind, queued_count, processing_count, worker_capacity,
        oldest_queued_age_ms, saturated
    ) VALUES (
        'worker_snapshot',
        GREATEST(0, p_queued_count),
        GREATEST(0, p_report_processing_count),
        GREATEST(1, p_worker_capacity),
        GREATEST(0, p_oldest_queued_age_ms),
        p_queued_count > 0 AND p_worker_occupied_count >= p_worker_capacity
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION logging.fn_report_pdf_observation_add(
    p_duration_ms BIGINT,
    p_budget_ms BIGINT,
    p_complex_rows INTEGER,
    p_failed BOOLEAN
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO logging.report_performance_observation (
        kind, duration_ms, budget_ms, complex_rows, failed
    ) VALUES (
        'pdf_render',
        GREATEST(0, p_duration_ms),
        GREATEST(1, p_budget_ms),
        GREATEST(0, p_complex_rows),
        COALESCE(p_failed, FALSE)
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION logging.fn_report_pdf_persist_failure_add()
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO logging.report_performance_observation (kind, failed)
    VALUES ('pdf_persist_failure', TRUE)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS logging.fn_report_pdf_persist_failure_add();
DROP FUNCTION IF EXISTS logging.fn_report_pdf_observation_add(
    BIGINT, BIGINT, INTEGER, BOOLEAN
);
DROP FUNCTION IF EXISTS logging.fn_report_worker_observation_add(
    INTEGER, INTEGER, INTEGER, INTEGER, BIGINT
);
SELECT remove_retention_policy(
    'logging.report_performance_observation',
    if_exists => TRUE
);
-- LINT-IGNORE: destructive-drop
-- Operational samples are explicitly bounded, contain no customer records,
-- and are safe to discard when rolling back the alerting capability.
DROP TABLE IF EXISTS logging.report_performance_observation;
