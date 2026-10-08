--------------UP
-- Widens fn_device_power_avg (20044) with the tag pair to read, so a kVA
-- demand tariff can bill apparent power. Apparent power has the same storage
-- shape as active power — per-phase `apparent_power` with `total_apparent_power`
-- as the meter's own fallback — so the ladder is identical and only the two tag
-- names change. A separate function would be the same body twice.
--
-- 20044 shipped in a commit, and the migration ledger keys on file path, so
-- editing it in place would never re-run where it already applied.
SET search_path TO device_em, public;

-- The new defaults reproduce 20044's hard-coded tags, so the four-argument
-- callers in energyReportBoundedSeries.ts keep working unchanged. The old
-- signature has to go first: left in place, a four-argument call is ambiguous.
DROP FUNCTION IF EXISTS device_em.fn_device_power_avg(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, TEXT);
CREATE OR REPLACE FUNCTION device_em.fn_device_power_avg(
    p_devices   INTEGER[],
    p_from      TIMESTAMP WITH TIME ZONE,
    p_to        TIMESTAMP WITH TIME ZONE,
    p_bucket    TEXT,
    p_phase_tag TEXT DEFAULT 'power',
    p_total_tag TEXT DEFAULT 'total_power'
)
RETURNS TABLE (
    bucket TIMESTAMP WITH TIME ZONE,
    device INTEGER,
    avg_w  DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    WITH scoped AS (
        SELECT time_bucket(p_bucket::INTERVAL, s.bucket) AS out_bucket,
               s.bucket AS bucket_15min,
               s.device, s.tag, s.phase, s.channel,
               s.sum_val, s.sample_count
        FROM device_em.logical_energy_15min s
        WHERE s.device = ANY(p_devices)
          AND s.bucket >= p_from
          AND s.bucket <  p_to
          AND s.tag IN (p_phase_tag, p_total_tag)
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
          AND s.sample_count > 0
    ),
    -- Same ladder as the peak, at the finest grain the rollup has.
    -- No source gate here: the rollup writer already applied it (6773), which
    -- is why energy_15min has no source column.
    --
    -- MAX(sample_count), not SUM: the phases share timestamps, so their counts
    -- are the same number and summing would divide by three times the instants.
    per_channel_bucket AS (
        SELECT c.out_bucket, c.device, c.channel, c.bucket_15min,
               COALESCE(
                   SUM(c.sum_val) FILTER (WHERE c.tag = p_phase_tag),
                   SUM(c.sum_val) FILTER (WHERE c.tag = p_total_tag)
               ) AS watt_sum,
               COALESCE(
                   MAX(c.sample_count) FILTER (WHERE c.tag = p_phase_tag),
                   MAX(c.sample_count) FILTER (WHERE c.tag = p_total_tag)
               ) AS samples
        FROM scoped c
        GROUP BY c.out_bucket, c.device, c.channel, c.bucket_15min
    ),
    -- Weighted by sample count, so a one-sample bucket does not count as much
    -- as a full one. Same weighting fn_report_stats_rollup uses.
    per_channel AS (
        SELECT p.out_bucket, p.device, p.channel,
               SUM(p.watt_sum) / NULLIF(SUM(p.samples), 0) AS avg_w
        FROM per_channel_bucket p
        GROUP BY p.out_bucket, p.device, p.channel
    )
    SELECT a.out_bucket, a.device, SUM(a.avg_w)
    FROM per_channel a
    GROUP BY a.out_bucket, a.device
    ORDER BY a.out_bucket, a.device;
$$;
--------------DOWN
SET search_path TO device_em, public;
DROP FUNCTION IF EXISTS device_em.fn_device_power_avg(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE,
    TEXT, TEXT, TEXT);

-- Restores 20044's signature, so a rollback leaves the four-argument callers
-- with a function to call.
CREATE OR REPLACE FUNCTION device_em.fn_device_power_avg(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE,
    p_bucket  TEXT
)
RETURNS TABLE (
    bucket TIMESTAMP WITH TIME ZONE,
    device INTEGER,
    avg_w  DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    WITH scoped AS (
        SELECT time_bucket(p_bucket::INTERVAL, s.bucket) AS out_bucket,
               s.bucket AS bucket_15min,
               s.device, s.tag, s.phase, s.channel,
               s.sum_val, s.sample_count
        FROM device_em.logical_energy_15min s
        WHERE s.device = ANY(p_devices)
          AND s.bucket >= p_from
          AND s.bucket <  p_to
          AND s.tag IN ('power', 'total_power')
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
          AND s.sample_count > 0
    ),
    per_channel_bucket AS (
        SELECT c.out_bucket, c.device, c.channel, c.bucket_15min,
               COALESCE(
                   SUM(c.sum_val) FILTER (WHERE c.tag = 'power'),
                   SUM(c.sum_val) FILTER (WHERE c.tag = 'total_power')
               ) AS watt_sum,
               COALESCE(
                   MAX(c.sample_count) FILTER (WHERE c.tag = 'power'),
                   MAX(c.sample_count) FILTER (WHERE c.tag = 'total_power')
               ) AS samples
        FROM scoped c
        GROUP BY c.out_bucket, c.device, c.channel, c.bucket_15min
    ),
    per_channel AS (
        SELECT p.out_bucket, p.device, p.channel,
               SUM(p.watt_sum) / NULLIF(SUM(p.samples), 0) AS avg_w
        FROM per_channel_bucket p
        GROUP BY p.out_bucket, p.device, p.channel
    )
    SELECT a.out_bucket, a.device, SUM(a.avg_w)
    FROM per_channel a
    GROUP BY a.out_bucket, a.device
    ORDER BY a.out_bucket, a.device;
$$;
