--------------UP
-- Upsert a batch of raw readings into the 15-minute rollup. Same array shape
-- as device_em.fn_append_stats, so every place that appends raw can append the
-- rollup with the same payload. Buckets by 15 min, then merges into existing
-- rows: sums energy deltas, counts samples (reader divides for averages), and
-- tracks min/max. Re-running the same batch ADDS — so callers must append each
-- reading exactly once (idempotency is the caller's job, matching fn_append_stats).
CREATE OR REPLACE FUNCTION device_em.fn_append_energy_15min(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
)
RETURNS void
AS
$$
    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag,
         sum_val, sample_count, min_val, max_val)
    SELECT
        time_bucket(INTERVAL '15 min', to_timestamp(u._ts)),
        u.device, u.phase, u.channel, u.tag,
        SUM(u.val::DOUBLE PRECISION),
        COUNT(*),
        MIN(u.val::DOUBLE PRECISION),
        MAX(u.val::DOUBLE PRECISION)
    FROM unnest(p_device, p_tag, p_phase, p_channel, p_ts, p_val)
         AS u(device, tag, phase, channel, _ts, val)
    GROUP BY 1, u.device, u.phase, u.channel, u.tag
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = device_em.energy_15min.sum_val + EXCLUDED.sum_val,
        sample_count = device_em.energy_15min.sample_count + EXCLUDED.sample_count,
        min_val      = LEAST(device_em.energy_15min.min_val, EXCLUDED.min_val),
        max_val      = GREATEST(device_em.energy_15min.max_val, EXCLUDED.max_val);
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(
    INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]
);
