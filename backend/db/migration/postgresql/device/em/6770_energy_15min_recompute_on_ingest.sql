--------------UP
-- Energy meter model, ingest plan (doc 15) Decision 2: change the 15-minute
-- rollup write from a running sum to a recompute-on-ingest.
--
-- Before: sum_val = sum_val + EXCLUDED (accumulate). Correct only because raw
-- device_em.stats dedups at insert; a re-delivered or late raw row would
-- otherwise double-count it. After: each bucket the batch touches is
-- re-aggregated from the raw rows that back it and written with SET, so the
-- rollup is a deterministic function of raw — re-delivery, crash-retry, and
-- late data all converge to the same total. DISTINCT ON (ts) collapses a
-- re-delivered raw reading so the recompute stays correct even once the raw
-- unique index is dropped (doc 15 phase 2).
--
-- The recompute reads raw at ingest time, which always includes the rows just
-- written (fn_append_stats runs first in energyRollup.appendEmStats), so a
-- bucket is rolled up the moment its raw lands — old backfill included.
--
-- Restore `public` so the TimescaleDB time_bucket function resolves — later em
-- migrations leave search_path at `device_em`, where it is not visible.
SET search_path TO device_em, public;

DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
CREATE FUNCTION device_em.fn_append_energy_15min(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_domain  VARCHAR(16)[],
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
    WITH affected AS (
        SELECT DISTINCT
            time_bucket(INTERVAL '15 min', to_timestamp(u._ts)) AS bucket,
            u.device, u.tag, u.domain, u.phase, u.channel
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts)
             AS u(device, tag, domain, phase, channel, _ts)
    ),
    recomputed AS (
        SELECT
            a.bucket, a.device, a.tag, a.domain, a.phase, a.channel,
            SUM(d.val)   AS sum_val,
            COUNT(*)     AS sample_count,
            MIN(d.val)   AS min_val,
            MAX(d.val)   AS max_val
        FROM affected a
        CROSS JOIN LATERAL (
            -- One value per raw timestamp: dedups a re-delivered reading so the
            -- recompute is correct even without the raw unique index.
            SELECT DISTINCT ON (s.ts) s.val::DOUBLE PRECISION AS val
            FROM device_em.stats s
            WHERE s.device  = a.device
              AND s.tag     = a.tag
              AND s.domain  = a.domain
              AND s.phase   IS NOT DISTINCT FROM a.phase
              AND s.channel IS NOT DISTINCT FROM a.channel
              AND s.ts >= a.bucket
              AND s.ts <  a.bucket + INTERVAL '15 min'
            ORDER BY s.ts
        ) d
        GROUP BY a.bucket, a.device, a.tag, a.domain, a.phase, a.channel
    )
    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, domain,
         sum_val, sample_count, min_val, max_val)
    SELECT
        bucket, device, phase, channel, tag, domain,
        sum_val, sample_count, min_val, max_val
    FROM recomputed
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = EXCLUDED.sum_val,
        sample_count = EXCLUDED.sample_count,
        min_val      = EXCLUDED.min_val,
        max_val      = EXCLUDED.max_val;
$$;

CREATE FUNCTION device_em.fn_append_energy_15min(
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
    SELECT device_em.fn_append_energy_15min(
        p_device,
        p_tag,
        array_fill('ac_mains'::VARCHAR(16), ARRAY[COALESCE(array_length(p_tag, 1), 0)]),
        p_phase,
        p_channel,
        p_ts,
        p_val
    );
$$
LANGUAGE sql;
--------------DOWN
-- Restore the running-sum form (origin 6769).
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
CREATE FUNCTION device_em.fn_append_energy_15min(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_domain  VARCHAR(16)[],
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
        (bucket, device, phase, channel, tag, domain,
         sum_val, sample_count, min_val, max_val)
    SELECT
        time_bucket(INTERVAL '15 min', to_timestamp(u._ts)),
        u.device, u.phase, u.channel, u.tag, u.domain,
        SUM(u.val::DOUBLE PRECISION),
        COUNT(*),
        MIN(u.val::DOUBLE PRECISION),
        MAX(u.val::DOUBLE PRECISION)
    FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val)
         AS u(device, tag, domain, phase, channel, _ts, val)
    GROUP BY 1, u.device, u.phase, u.channel, u.tag, u.domain
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = device_em.energy_15min.sum_val + EXCLUDED.sum_val,
        sample_count = device_em.energy_15min.sample_count + EXCLUDED.sample_count,
        min_val      = LEAST(device_em.energy_15min.min_val, EXCLUDED.min_val),
        max_val      = GREATEST(device_em.energy_15min.max_val, EXCLUDED.max_val);
$$;

CREATE FUNCTION device_em.fn_append_energy_15min(
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
    SELECT device_em.fn_append_energy_15min(
        p_device,
        p_tag,
        array_fill('ac_mains'::VARCHAR(16), ARRAY[COALESCE(array_length(p_tag, 1), 0)]),
        p_phase,
        p_channel,
        p_ts,
        p_val
    );
$$
LANGUAGE sql;
