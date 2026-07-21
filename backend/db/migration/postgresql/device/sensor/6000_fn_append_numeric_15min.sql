--------------UP
-- Upsert numeric readings into 15-min buckets. Accumulating is safe for
-- instantaneous values: a re-delivered reading scales sum_val and sample_count
-- together, so avg and min/max are unchanged. Function-scoped SET lifts the
-- decompression cap for a late reading hitting a compressed chunk (see energy).
SET search_path TO public;

CREATE OR REPLACE FUNCTION device_sensor.fn_append_numeric_15min(
    p_device  INT[],
    p_source  VARCHAR(12)[],
    p_kind    VARCHAR(24)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
)
RETURNS void
LANGUAGE sql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
    INSERT INTO device_sensor.numeric_15min
        (bucket, device, source, kind, channel,
         sum_val, sample_count, min_val, max_val)
    SELECT
        time_bucket(INTERVAL '15 min', to_timestamp(u._ts)),
        u.device, u.source, u.kind, u.channel,
        SUM(u.val::DOUBLE PRECISION),
        COUNT(*),
        MIN(u.val::DOUBLE PRECISION),
        MAX(u.val::DOUBLE PRECISION)
    FROM unnest(p_device, p_source, p_kind, p_channel, p_ts, p_val)
         AS u(device, source, kind, channel, _ts, val)
    GROUP BY 1, u.device, u.source, u.kind, u.channel
    ON CONFLICT (bucket, device, source, kind, channel) DO UPDATE
    SET sum_val      = device_sensor.numeric_15min.sum_val + EXCLUDED.sum_val,
        sample_count = device_sensor.numeric_15min.sample_count + EXCLUDED.sample_count,
        min_val      = LEAST(device_sensor.numeric_15min.min_val, EXCLUDED.min_val),
        max_val      = GREATEST(device_sensor.numeric_15min.max_val, EXCLUDED.max_val);
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_sensor.fn_append_numeric_15min(INT[], VARCHAR(12)[], VARCHAR(24)[], SMALLINT[], BIGINT[], REAL[]);
