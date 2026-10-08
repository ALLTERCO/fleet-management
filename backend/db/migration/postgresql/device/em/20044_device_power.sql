--------------UP
-- Device total power. SQL took MAX or AVG over per-phase rows, so a 3-phase
-- meter read about a third of its real power.
--
-- Three storage shapes collapse to one device number:
--   triphase  em:0       ('power','a'|'b'|'c',0) plus its own ('total_power','z',0)
--   monophase em1:0/1/2  ('power','z',0|1|2), no total_power
--   single phase         one ('power','z',0)
--
-- Both readers share three rules, taken from code that already had them:
--   sum across phase and channel   fn_report_energy_15min_by_channel (6766)
--   per-phase wins, total is the   componentPowerReadings
--     fallback, never both           (src/types/api/componentPower.ts:146)
--   em-sync over live              6773_energy_15min_billing_grade
--
-- The ladder is written once per grain, not once overall: raw stores `val`,
-- the rollup stores sum_val/sample_count, so one expression cannot serve both.
SET search_path TO device_em, public;

-- Peak. Reads raw because a coincident peak needs the individual timestamps;
-- the rollup keeps only a per-phase max, and those may be different instants.
-- logical_stats, not stats: the view adds virtual devices and their scaling,
-- and still carries `source` for the gate below.
CREATE OR REPLACE FUNCTION device_em.fn_device_power_peak(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
    device INTEGER,
    peak_w DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    WITH scoped AS (
        SELECT s.device, s.tag, s.phase, s.channel, s.ts, s.source,
               s.val::DOUBLE PRECISION AS val
        FROM device_em.logical_stats s
        WHERE s.device = ANY(p_devices)
          AND s.ts >= p_from
          AND s.ts <  p_to
          AND s.tag IN ('power', 'total_power')
          -- Without this a device metering mains and a DC string sums both.
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
    ),
    -- Live (15s) and em-sync (1m) write the same tag on different timestamp
    -- grids, so keeping both double counts. Gated per series over the window,
    -- because this function returns one number and has no bucket.
    gate AS (
        SELECT g.device, g.tag, g.phase, g.channel,
               bool_or(g.source = 'em_sync') AS has_emsync
        FROM scoped g
        GROUP BY g.device, g.tag, g.phase, g.channel
    ),
    chosen AS (
        SELECT c.device, c.tag, c.phase, c.channel, c.ts, c.val
        FROM scoped c
        JOIN gate
          ON gate.device  =  c.device
         AND gate.tag     =  c.tag
         AND gate.phase   IS NOT DISTINCT FROM c.phase
         AND gate.channel IS NOT DISTINCT FROM c.channel
        WHERE CASE
                  WHEN COALESCE(gate.has_emsync, FALSE)
                      THEN c.source = 'em_sync'
                  ELSE TRUE
              END
    ),
    -- Per-phase rows win; the meter's own total is the fallback. Adding both
    -- is the double count.
    per_instant AS (
        SELECT c.device, c.channel, c.ts,
               COALESCE(
                   SUM(c.val) FILTER (WHERE c.tag = 'power'),
                   SUM(c.val) FILTER (WHERE c.tag = 'total_power')
               ) AS watts
        FROM chosen c
        GROUP BY c.device, c.channel, c.ts
    ),
    -- A monophase meter spreads its phases over channels.
    per_ts AS (
        SELECT i.device, i.ts, SUM(i.watts) AS watts
        FROM per_instant i
        WHERE i.watts IS NOT NULL
        GROUP BY i.device, i.ts
    )
    SELECT t.device, MAX(t.watts)
    FROM per_ts t
    GROUP BY t.device
    ORDER BY t.device;
$$;

-- Average. Reads the rollup, so it answers year-range questions the peak
-- cannot: raw is trimmed to about a month (6774). Safe because the average of
-- a sum equals the sum of the averages, and the phases of one meter share
-- timestamps so they share sample counts. Proven by
-- deviceTotalPowerAvg.integration.ts, which asserts raw and rollup agree.
-- p_bucket is an interval string and must be >= 15 min.
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
    -- Same ladder as the peak, at the finest grain the rollup has.
    -- No source gate here: the rollup writer already applied it (6773), which
    -- is why energy_15min has no source column.
    --
    -- MAX(sample_count), not SUM: the phases share timestamps, so their counts
    -- are the same number and summing would divide by three times the instants.
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
DROP FUNCTION IF EXISTS device_em.fn_device_power_peak(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
DROP FUNCTION IF EXISTS device_em.fn_device_power_avg(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, TEXT);
