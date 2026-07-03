--------------UP
-- Rollup upserts legitimately touch COMPRESSED chunks: emSync backfills offline
-- gaps late, and back-dated device clocks land readings days in the past — both
-- into chunks the 7-day columnstore policy has already compressed. Updating a
-- single bucket decompresses that bucket's whole (device,tag) compressed segment,
-- so a multi-device batch quickly exceeds the default
-- timescaledb.max_tuples_decompressed_per_dml_transaction (100000) and the ENTIRE
-- "INSERT ... ON CONFLICT DO UPDATE" statement aborts. The rollup append is then
-- silently skipped (logged as "energy_15min rollup append failed (raw written,
-- rollup skipped): tuple decompression limit exceeded") while raw device_em.stats
-- keeps the reading. Net effect: energy_15min under-counts every batch that shared
-- a transaction with a back-dated row — INCLUDING the current-window rows in that
-- batch — so consumption reports at >=15min granularity read ~half the real energy.
--
-- Fix: lift the decompression cap for THIS writer only, via a function-scoped SET
-- (the GUC is USERSET, so a SET clause on the function applies for the duration of
-- each call and resets afterwards — no session/global change). Recompression of any
-- chunk this touches is handled by the existing columnstore policy on its next run.
CREATE OR REPLACE FUNCTION device_em.fn_append_energy_15min(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
)
RETURNS void
LANGUAGE sql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
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
$$;
--------------DOWN
-- Revert to the capped definition (no function-scoped decompression override).
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
