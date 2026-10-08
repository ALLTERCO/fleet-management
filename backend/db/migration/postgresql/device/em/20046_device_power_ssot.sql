--------------UP
-- One home for the device-power rule. 20044 wrote the tag pair, the
-- electricity scope, the no-double-count ladder and the sum across phase and
-- channel into each reader; every further site would have added another copy.
--
-- Two definitions, not one, because raw stores `val` and the rollup stores
-- sum_val/sample_count — one expression cannot serve both grains.
--
-- Set-returning functions rather than views: the raw-grain source gate is
-- scoped to the query window, and a view has no window to scope it to. They
-- also carry the tag pair as a parameter, which a view cannot.
SET search_path TO device_em, public;

-- Raw grain: one device total per instant, ready for MAX (peak), AVG or MIN.
-- logical_stats, not stats — it adds virtual devices and their scaling, and
-- still carries `source` for the gate below.
CREATE OR REPLACE FUNCTION device_em.fn_power_instant(
    p_devices   INTEGER[],
    p_from      TIMESTAMP WITH TIME ZONE,
    p_to        TIMESTAMP WITH TIME ZONE,
    p_phase_tag TEXT,
    p_total_tag TEXT
)
RETURNS TABLE (
    device INTEGER,
    ts     TIMESTAMP WITH TIME ZONE,
    watts  DOUBLE PRECISION
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
          AND s.tag IN (p_phase_tag, p_total_tag)
          -- Without this a device metering mains and a DC string sums both.
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
    ),
    -- Live (15s) and em-sync (1m) write the same tag on different timestamp
    -- grids, so keeping both double counts. Gated per series over the window.
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
                   SUM(c.val) FILTER (WHERE c.tag = p_phase_tag),
                   SUM(c.val) FILTER (WHERE c.tag = p_total_tag)
               ) AS watts
        FROM chosen c
        GROUP BY c.device, c.channel, c.ts
    )
    -- A monophase meter spreads its phases over channels.
    SELECT i.device, i.ts, SUM(i.watts)
    FROM per_instant i
    WHERE i.watts IS NOT NULL
    GROUP BY i.device, i.ts;
$$;

-- Rollup grain: the same ladder at the finest grain the rollup has, left
-- unaveraged so each caller can weight the buckets its own way.
-- No source gate — the rollup writer already applied it (6773), which is why
-- energy_15min has no source column.
CREATE OR REPLACE FUNCTION device_em.fn_power_15min(
    p_devices   INTEGER[],
    p_from      TIMESTAMP WITH TIME ZONE,
    p_to        TIMESTAMP WITH TIME ZONE,
    p_phase_tag TEXT,
    p_total_tag TEXT
)
RETURNS TABLE (
    device   INTEGER,
    bucket   TIMESTAMP WITH TIME ZONE,
    channel  SMALLINT,
    watt_sum DOUBLE PRECISION,
    samples  BIGINT
)
LANGUAGE sql STABLE
AS $$
    WITH scoped AS (
        SELECT s.bucket, s.device, s.tag, s.phase, s.channel,
               s.sum_val, s.sample_count
        FROM device_em.logical_energy_15min s
        WHERE s.device = ANY(p_devices)
          AND s.bucket >= p_from
          AND s.bucket <  p_to
          AND s.tag IN (p_phase_tag, p_total_tag)
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
          AND s.sample_count > 0
    )
    -- MAX(sample_count), not SUM: the phases share timestamps, so their counts
    -- are the same number and summing would divide by three times the instants.
    SELECT c.device, c.bucket, c.channel,
           COALESCE(
               SUM(c.sum_val) FILTER (WHERE c.tag = p_phase_tag),
               SUM(c.sum_val) FILTER (WHERE c.tag = p_total_tag)
           ),
           COALESCE(
               MAX(c.sample_count) FILTER (WHERE c.tag = p_phase_tag),
               MAX(c.sample_count) FILTER (WHERE c.tag = p_total_tag)
           )
    FROM scoped c
    GROUP BY c.device, c.bucket, c.channel;
$$;

-- Peak. Raw, because a coincident peak needs the individual timestamps; the
-- rollup keeps only a per-phase max, and those may be different instants.
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
    SELECT p.device, MAX(p.watts)
    FROM device_em.fn_power_instant(
             p_devices, p_from, p_to, 'power', 'total_power') p
    GROUP BY p.device
    ORDER BY p.device;
$$;

-- Average. Reads the rollup, so it answers year-range questions the peak
-- cannot: raw is trimmed to about a month (6774). Weighted by sample count,
-- so a one-sample bucket does not count as much as a full one.
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
    WITH per_channel AS (
        SELECT time_bucket(p_bucket::INTERVAL, r.bucket) AS out_bucket,
               r.device AS dev, r.channel AS ch,
               SUM(r.watt_sum) / NULLIF(SUM(r.samples), 0) AS avg_w
        FROM device_em.fn_power_15min(
                 p_devices, p_from, p_to, p_phase_tag, p_total_tag) r
        GROUP BY 1, r.device, r.channel
    )
    SELECT a.out_bucket, a.dev, SUM(a.avg_w)
    FROM per_channel a
    GROUP BY a.out_bucket, a.dev
    ORDER BY a.out_bucket, a.dev;
$$;

-- Always-on / phantom load: the smallest sustained window average, i.e. the
-- baseline that ran the whole window. A minimum has the same coincidence
-- problem a maximum does, so it goes over device totals, not phase rows.
--
-- BEHAVIOUR CHANGE: reads the 15-minute rollup instead of raw, so it now
-- covers windows older than the ~31-day raw retention (6774). A p_window
-- finer than 15 minutes collapses to the rollup grain.
CREATE OR REPLACE FUNCTION device_em.fn_always_on(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE,
    p_window  TEXT DEFAULT '15 minutes'
)
RETURNS TABLE (
    device           INTEGER,
    floor_watts      DOUBLE PRECISION,
    sample_count     INTEGER
)
LANGUAGE sql STABLE
AS $$
    WITH per_channel AS (
        SELECT time_bucket(p_window::INTERVAL, r.bucket) AS win,
               r.device AS dev, r.channel AS ch,
               SUM(r.watt_sum) / NULLIF(SUM(r.samples), 0) AS avg_w,
               SUM(r.samples) AS samples
        FROM device_em.fn_power_15min(
                 p_devices, p_from, p_to, 'power', 'total_power') r
        GROUP BY 1, r.device, r.channel
    ),
    per_window AS (
        SELECT c.win, c.dev,
               SUM(c.avg_w) AS watts,
               SUM(c.samples) AS samples
        FROM per_channel c
        GROUP BY c.win, c.dev
    )
    SELECT w.dev, MIN(w.watts)::DOUBLE PRECISION, SUM(w.samples)::INTEGER
    FROM per_window w
    GROUP BY w.dev
    ORDER BY w.dev;
$$;

-- Per-device aggregation for Analytics.AttributeWindow brush-to-compare.
-- 'power' under avg/max is a device total and comes from the shared ladder;
-- every other tag and aggregation keeps reading raw exactly as before.
-- 'latest' stays on raw: a single last reading has no coincident equivalent.
CREATE OR REPLACE FUNCTION device_em.fn_attribute_window(
    p_devices     INTEGER[],
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ,
    p_tags        VARCHAR(30)[],
    p_aggregation TEXT
)
RETURNS TABLE (
    device       INTEGER,
    tag          VARCHAR(30),
    agg_value    DOUBLE PRECISION,
    sample_count INTEGER
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
    RETURN QUERY
    WITH coincident AS (
        SELECT p.device                    AS device,
               'power'::VARCHAR(30)        AS tag,
               CASE p_aggregation
                   WHEN 'max' THEN MAX(p.watts)
                   ELSE AVG(p.watts)
               END                         AS agg_value,
               COUNT(*)::INT               AS sample_count
        FROM device_em.fn_power_instant(
                 p_devices, p_from, p_to, 'power', 'total_power') p
        WHERE p_aggregation IN ('avg', 'max')
          AND 'power' = ANY(p_tags)
        GROUP BY p.device
    ),
    per_tag AS (
        SELECT
            s.device                                    AS device,
            s.tag                                       AS tag,
            CASE p_aggregation
                WHEN 'sum'    THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
                WHEN 'avg'    THEN CAST(AVG(s.val) AS DOUBLE PRECISION)
                WHEN 'max'    THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
                WHEN 'latest' THEN (
                    SELECT CAST(s2.val AS DOUBLE PRECISION)
                    FROM device_em.stats s2
                    WHERE s2.device = s.device
                      AND s2.tag = s.tag
                      AND s2.ts >= p_from
                      AND s2.ts <  p_to
                    ORDER BY s2.ts DESC
                    LIMIT 1
                )
                ELSE CAST(SUM(s.val) AS DOUBLE PRECISION)
            END                                         AS agg_value,
            COUNT(*)::INT                               AS sample_count
        FROM device_em.stats s
        WHERE s.device = ANY(p_devices)
          AND s.ts >= p_from
          AND s.ts <  p_to
          AND s.tag  = ANY(p_tags)
          AND NOT (s.tag = 'power' AND p_aggregation IN ('avg', 'max'))
        GROUP BY s.device, s.tag
    )
    SELECT u.device, u.tag, u.agg_value, u.sample_count
    FROM (
        SELECT * FROM coincident
        UNION ALL
        SELECT * FROM per_tag
    ) u
    ORDER BY u.device, u.tag;
END;
$$;
--------------DOWN
SET search_path TO device_em, public;

-- Restores each reader to the definition it had before this migration, then
-- removes the shared ladder they no longer call.

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
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
    ),
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
    per_instant AS (
        SELECT c.device, c.channel, c.ts,
               COALESCE(
                   SUM(c.val) FILTER (WHERE c.tag = 'power'),
                   SUM(c.val) FILTER (WHERE c.tag = 'total_power')
               ) AS watts
        FROM chosen c
        GROUP BY c.device, c.channel, c.ts
    ),
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

CREATE OR REPLACE FUNCTION device_em.fn_always_on(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE,
    p_window  TEXT DEFAULT '15 minutes'
)
RETURNS TABLE (
    device           INTEGER,
    floor_watts      DOUBLE PRECISION,
    sample_count     INTEGER
)
AS
$$
BEGIN
    RETURN QUERY
    WITH binned AS (
        SELECT
            s.device                                          AS device,
            time_bucket(p_window::interval, s.ts)             AS bucket,
            AVG(s.val)                                        AS avg_watts,
            COUNT(*)::INTEGER                                 AS samples
        FROM device_em.stats s
        WHERE s.device = ANY(p_devices)
          AND s.ts >= p_from
          AND s.ts <  p_to
          AND s.tag  = 'power'
        GROUP BY s.device, bucket
    )
    SELECT
        binned.device                                         AS device,
        MIN(binned.avg_watts)::DOUBLE PRECISION               AS floor_watts,
        SUM(binned.samples)::INTEGER                          AS sample_count
    FROM binned
    GROUP BY binned.device
    ORDER BY binned.device;
END;
$$
LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_attribute_window(
    p_devices     INTEGER[],
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ,
    p_tags        VARCHAR(30)[],
    p_aggregation TEXT
)
RETURNS TABLE (
    device       INTEGER,
    tag          VARCHAR(30),
    agg_value    DOUBLE PRECISION,
    sample_count INTEGER
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.device                                        AS device,
        s.tag                                           AS tag,
        CASE p_aggregation
            WHEN 'sum'    THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN 'avg'    THEN CAST(AVG(s.val) AS DOUBLE PRECISION)
            WHEN 'max'    THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            WHEN 'latest' THEN (
                SELECT CAST(s2.val AS DOUBLE PRECISION)
                FROM device_em.stats s2
                WHERE s2.device = s.device
                  AND s2.tag = s.tag
                  AND s2.ts >= p_from
                  AND s2.ts <  p_to
                ORDER BY s2.ts DESC
                LIMIT 1
            )
            ELSE CAST(SUM(s.val) AS DOUBLE PRECISION)
        END                                             AS agg_value,
        COUNT(*)::int                                   AS sample_count
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY s.device, s.tag
    ORDER BY s.device, s.tag;
END;
$$;

DROP FUNCTION IF EXISTS device_em.fn_power_instant(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, TEXT, TEXT);
DROP FUNCTION IF EXISTS device_em.fn_power_15min(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, TEXT, TEXT);
