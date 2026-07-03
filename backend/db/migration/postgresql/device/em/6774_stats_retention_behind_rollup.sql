--------------UP
-- Gate raw retention behind the rollup. The blind 31-day add_retention_policy
-- (6745) drops raw regardless of rollup progress; since the 15-minute rollup is
-- the permanent store and raw older than 31 days cannot be rebuilt, a stalled
-- rollup would silently lose energy. Drop raw only older than the EARLIER of
-- (now - retention) and the newest rolled-up bucket, so un-rolled raw always
-- survives. A daily job runs the gate.
SET search_path TO device_em, public;

-- Stop the blind policy; the gate replaces it.
SELECT remove_retention_policy('device_em.stats', if_exists => TRUE);

CREATE OR REPLACE FUNCTION device_em.fn_drop_rolled_up_stats(
    p_retention_days INT DEFAULT 31
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS
$$
DECLARE
    v_rollup_max TIMESTAMPTZ;
    v_horizon    TIMESTAMPTZ;
BEGIN
    SELECT max(bucket) INTO v_rollup_max FROM device_em.energy_15min;

    -- Nothing rolled up yet (fresh install / stalled rollup): drop nothing.
    -- (LEAST() ignores NULL, so this NULL guard must be explicit.)
    IF v_rollup_max IS NULL THEN
        RETURN NULL;
    END IF;

    -- Never advance past the rollup frontier.
    v_horizon := LEAST(
        now() - make_interval(days => p_retention_days),
        v_rollup_max
    );

    PERFORM drop_chunks('device_em.stats', older_than => v_horizon);
    RETURN v_horizon;
END;
$$;

-- TimescaleDB custom-job entry point (job_id, config) -> runs the gate daily.
CREATE OR REPLACE PROCEDURE device_em.job_retain_stats(
    job_id INT,
    config JSONB
)
LANGUAGE plpgsql
AS
$$
DECLARE
    v_days INT := COALESCE((config->>'retention_days')::INT, 31);
BEGIN
    PERFORM device_em.fn_drop_rolled_up_stats(v_days);
END;
$$;

-- Register the daily job once (skip if it already exists).
SELECT add_job(
    'device_em.job_retain_stats',
    schedule_interval => INTERVAL '1 day',
    config            => '{"retention_days": 31}'::jsonb
)
WHERE NOT EXISTS (
    SELECT 1 FROM timescaledb_information.jobs
    WHERE proc_schema = 'device_em' AND proc_name = 'job_retain_stats'
);
--------------DOWN
SET search_path TO device_em, public;
DO $$
DECLARE
    v_job_id INT;
BEGIN
    FOR v_job_id IN
        SELECT job_id FROM timescaledb_information.jobs
        WHERE proc_schema = 'device_em' AND proc_name = 'job_retain_stats'
    LOOP
        PERFORM delete_job(v_job_id);
    END LOOP;
END $$;
DROP PROCEDURE IF EXISTS device_em.job_retain_stats(INT, JSONB);
DROP FUNCTION IF EXISTS device_em.fn_drop_rolled_up_stats(INT);
-- Restore the blind 31-day policy.
SELECT add_retention_policy('device_em.stats', INTERVAL '31 days', if_not_exists => TRUE);
