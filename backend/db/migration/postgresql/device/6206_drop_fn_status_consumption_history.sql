--------------UP
-- LINT-IGNORE: additive-only (deliberate legacy function removal)
-- Phase 7 cleanup: drop the orphan `fn_status_consumption_history`.
--
-- Verified zero callers across `backend/src` and the rest of
-- `backend/db/migration`. The function was replaced in Phase 2b by
-- Energy.Query's tag-based path against `device_em.stats` — the
-- window-function-over-device.status approach here had fragile
-- `field_group IN (...)` patterns that missed cover / light / rgb
-- / monophase devices, which was a big part of why energy queries
-- were rewritten in the first place.
--
-- DOWN recreates the original definition verbatim for rollback.
DROP FUNCTION IF EXISTS device.fn_status_consumption_history(
    INTEGER[], TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR
);
--------------DOWN
CREATE OR REPLACE FUNCTION device.fn_status_consumption_history(
    p_device_ids INTEGER[],
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_period VARCHAR(10) DEFAULT 'day'
)
RETURNS TABLE (
    bucket TEXT,
    device_id INTEGER,
    total_energy_kwh NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
    _period VARCHAR;
    _interval INTERVAL;
BEGIN
    IF p_period = 'month' THEN
        _period := 'YYYY-MM';
        _interval := INTERVAL '1 month';
    ELSIF p_period = 'hour' THEN
        _period := 'YYYY-MM-DD HH24';
        _interval := INTERVAL '1 hour';
    ELSE
        _period := 'YYYY-MM-DD';
        _interval := INTERVAL '1 day';
    END IF;

    RETURN QUERY
    WITH consumption_data AS (
        SELECT
            to_char(s.ts, _period) as time_bucket,
            s.id as dev_id,
            s.field,
            s.value,
            s.ts,
            FIRST_VALUE(s.value) OVER (
                PARTITION BY s.id, s.field, to_char(s.ts, _period)
                ORDER BY s.ts ASC
            ) as first_val,
            LAST_VALUE(s.value) OVER (
                PARTITION BY s.id, s.field, to_char(s.ts, _period)
                ORDER BY s.ts ASC
                ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
            ) as last_val
        FROM device.status s
        WHERE s.id = ANY(p_device_ids)
            AND s.ts >= p_from
            AND s.ts <= p_to
            AND s.field_group IN ('switch:*.aenergy.total', 'pm1:*.aenergy.total')
    ),
    aggregated AS (
        SELECT DISTINCT
            time_bucket,
            dev_id,
            field,
            (last_val - first_val) / 1000.0 as consumption_kwh
        FROM consumption_data
    )
    SELECT
        time_bucket as bucket,
        dev_id as device_id,
        SUM(consumption_kwh)::NUMERIC as total_energy_kwh
    FROM aggregated
    WHERE consumption_kwh >= 0
    GROUP BY time_bucket, dev_id
    ORDER BY time_bucket, dev_id;
END;
$$;
