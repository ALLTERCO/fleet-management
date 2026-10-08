-- The other 15-minute readers add the records of EM buckets not yet rolled,
-- as the report stats functions do since 20181: cost by channel, channel
-- totals, daily consumption and device power (average, always-on). Without
-- this they miss an open EM bucket until it closes. The physical readers go
-- through fn_energy_15min_rows; device power reads the logical rows (7350,
-- 20190), so it gets the same rule under the logical identity, and a custom
-- device in the scope keeps owning the source channels it represents (20163).
--------------UP
SET search_path TO device_em, public;

-- fn_energy_15min_rows for the logical rows: a key not rolled yet is read from
-- the meter's own minute records, for the meter and for every linked custom
-- device that reads that key. Which tags a custom device reads is decided by
-- the logical views (fn_stats_readings with p_logical); a record row of a
-- custom device is matched to its source key through the linked binding.
CREATE OR REPLACE FUNCTION device_em.fn_logical_energy_15min_rows(
    p_devices INT[],
    p_from    TIMESTAMPTZ,
    p_to      TIMESTAMPTZ,
    p_tags    VARCHAR(30)[]
)
RETURNS TABLE (
    bucket            TIMESTAMPTZ,
    device            INT,
    tag               VARCHAR(30),
    domain            VARCHAR(16),
    phase             VARCHAR(1),
    channel           SMALLINT,
    sum_val           DOUBLE PRECISION,
    sample_count      BIGINT,
    min_val           DOUBLE PRECISION,
    max_val           DOUBLE PRECISION,
    commodity         VARCHAR(12),
    electrical_source VARCHAR(16)
)
LANGUAGE sql
STABLE
AS $$
    WITH linked AS MATERIALIZED (
        SELECT b.virtual_device_list_id AS device,
               b.source_device_list_id AS source_device,
               b.source_channel,
               b.effective_from,
               COALESCE(b.effective_to, 'infinity'::timestamptz) AS effective_until
          FROM device.virtual_energy_binding_projection b
         WHERE b.mode = 'linked'
           AND b.virtual_device_list_id = ANY(p_devices)
    ),
    unrolled AS MATERIALIZED (
        SELECT d.bucket, d.device, d.tag, d.domain, d.phase, d.channel
          FROM device_em.rollup_dirty d
         WHERE d.tag = ANY(p_tags)
           AND d.bucket >= p_from
           AND d.bucket < p_to
           AND d.blocked_at IS NULL
           AND d.bucket >= COALESCE(device_em.fn_stats_retention_horizon(), '-infinity')
           AND (d.device = ANY(p_devices)
                OR d.device IN (SELECT l.source_device FROM linked l))
    ),
    records AS MATERIALIZED (
        SELECT time_bucket(INTERVAL '15 min', r.ts) AS bucket,
               r.device, r.tag, r.domain, r.phase, r.channel,
               sum(r.val) AS sum_val, count(*)::BIGINT AS sample_count,
               min(r.val) AS min_val, max(r.val) AS max_val,
               r.commodity, r.electrical_source
          FROM (SELECT DISTINCT u.bucket FROM unrolled u) b
          CROSS JOIN LATERAL device_em.fn_stats_readings(
              p_devices, b.bucket, b.bucket + INTERVAL '15 min', p_tags, TRUE) r
         WHERE r.source = 'em_sync'
           AND EXISTS (
               SELECT 1 FROM unrolled u
                WHERE u.bucket = b.bucket AND u.tag = r.tag
                  AND u.domain = r.domain AND u.phase IS NOT DISTINCT FROM r.phase
                  AND u.channel IS NOT DISTINCT FROM r.channel
                  AND (u.device = r.device
                       OR EXISTS (
                           SELECT 1 FROM linked l
                            WHERE l.device = r.device
                              AND l.source_device = u.device
                              AND l.source_channel = COALESCE(u.channel, 0)
                              AND u.bucket >= l.effective_from
                              AND u.bucket < l.effective_until))
           )
         GROUP BY 1, r.device, r.tag, r.domain, r.phase, r.channel,
                  r.commodity, r.electrical_source
    )
    SELECT e.bucket, e.device, e.tag, e.domain, e.phase, e.channel,
           e.sum_val, e.sample_count, e.min_val, e.max_val,
           e.commodity, e.electrical_source
      FROM device_em.fn_logical_energy_15min_in_scope(p_devices) e
     WHERE e.bucket >= p_from AND e.bucket < p_to
       AND e.tag = ANY(p_tags)
       AND NOT EXISTS (
           SELECT 1 FROM records x
            WHERE x.bucket = e.bucket AND x.device = e.device AND x.tag = e.tag
              AND x.domain = e.domain AND x.phase IS NOT DISTINCT FROM e.phase
              AND x.channel IS NOT DISTINCT FROM e.channel)
    UNION ALL
    SELECT x.bucket, x.device, x.tag, x.domain, x.phase, x.channel,
           x.sum_val, x.sample_count, x.min_val, x.max_val,
           x.commodity, x.electrical_source
      FROM records x;
$$;

-- 20163 over the logical rows that include buckets not yet rolled.
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
        FROM device_em.fn_logical_energy_15min_rows(
                 p_devices, p_from, p_to,
                 ARRAY[p_phase_tag, p_total_tag]::VARCHAR(30)[]) s
        WHERE s.commodity = 'electricity'
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

-- 20040 over the rows that include buckets not yet rolled.
CREATE OR REPLACE FUNCTION device_em.fn_report_energy_15min_by_channel(
    p_devices INTEGER[],
    p_from TIMESTAMP WITH TIME ZONE,
    p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[],
    p_commodity TEXT DEFAULT NULL,
    p_electrical_source TEXT DEFAULT NULL
)
RETURNS TABLE (
    bucket TIMESTAMP WITH TIME ZONE,
    device INTEGER,
    channel SMALLINT,
    tag VARCHAR(30),
    energy_wh DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    SELECT s.bucket, s.device, s.channel, s.tag, SUM(s.sum_val)
    FROM device_em.fn_energy_15min_rows(p_devices, p_from, p_to, p_tags) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (
          p_electrical_source IS NULL
          OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source
      )
    GROUP BY s.bucket, s.device, s.channel, s.tag
    ORDER BY s.bucket, s.device, s.channel, s.tag;
$$;

-- 6780 over the rows that include buckets not yet rolled.
CREATE OR REPLACE FUNCTION device_em.fn_report_channel_energy_totals(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[],
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (device INTEGER, channel SMALLINT, tag VARCHAR(30), total_wh DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT s.device, s.channel, s.tag, SUM(s.sum_val)
    FROM device_em.fn_energy_15min_rows(p_devices, p_from, p_to, p_tags) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY s.device, s.channel, s.tag;
$$;

-- 20052 over the rows that include buckets not yet rolled. The scope is cut
-- to the organization's devices before any row is read.
CREATE OR REPLACE FUNCTION device_em.fn_daily_consumption(
    p_organization_id VARCHAR,
    p_devices         INTEGER[],
    p_tags            VARCHAR(30)[],
    p_from            TIMESTAMP WITH TIME ZONE,
    p_to              TIMESTAMP WITH TIME ZONE,
    p_tz              TEXT
)
RETURNS TABLE (
    device           INTEGER,
    channel          SMALLINT,
    tag              VARCHAR(30),
    local_day        DATE,
    local_day_start  TIMESTAMP WITH TIME ZONE,
    raw_total        DOUBLE PRECISION,
    max_bucket_value DOUBLE PRECISION,
    observed_buckets INTEGER,
    expected_buckets INTEGER
)
LANGUAGE sql STABLE
AS $$
    WITH expected AS (
        SELECT
            (bucket AT TIME ZONE p_tz)::DATE AS local_day,
            COUNT(*)::INTEGER AS expected_buckets
        FROM generate_series(
            p_from,
            p_to - INTERVAL '15 minutes',
            INTERVAL '15 minutes'
        ) AS bucket
        GROUP BY (bucket AT TIME ZONE p_tz)::DATE
    ),
    owned AS (
        SELECT array_agg(d.id) AS ids
        FROM device.list d
        WHERE d.id = ANY(p_devices)
          AND d.organization_id = p_organization_id
    ),
    bucket_values AS (
        SELECT
            s.bucket,
            s.device,
            s.channel,
            s.tag,
            SUM(s.sum_val)::DOUBLE PRECISION AS bucket_value
        FROM owned o
        CROSS JOIN LATERAL device_em.fn_energy_15min_rows(
            o.ids, p_from, p_to, p_tags) s
        GROUP BY s.bucket, s.device, s.channel, s.tag
    ),
    daily AS (
        SELECT
            b.device,
            b.channel,
            b.tag,
            (b.bucket AT TIME ZONE p_tz)::DATE AS local_day,
            SUM(b.bucket_value)::DOUBLE PRECISION AS raw_total,
            MAX(b.bucket_value)::DOUBLE PRECISION AS max_bucket_value,
            COUNT(DISTINCT b.bucket)::INTEGER AS observed_buckets
        FROM bucket_values b
        GROUP BY b.device, b.channel, b.tag, (b.bucket AT TIME ZONE p_tz)::DATE
    )
    SELECT
        d.device,
        d.channel,
        d.tag,
        d.local_day,
        d.local_day::TIMESTAMP AT TIME ZONE p_tz AS local_day_start,
        d.raw_total,
        d.max_bucket_value,
        d.observed_buckets,
        e.expected_buckets
    FROM daily d
    JOIN expected e USING (local_day)
    ORDER BY d.local_day, d.device, d.channel, d.tag;
$$;

--------------DOWN
SET search_path TO device_em, public;

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
        FROM device_em.fn_logical_energy_15min_in_scope(p_devices) s
        WHERE s.bucket >= p_from
          AND s.bucket <  p_to
          AND s.tag IN (p_phase_tag, p_total_tag)
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
          AND s.sample_count > 0
    )
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

CREATE OR REPLACE FUNCTION device_em.fn_report_energy_15min_by_channel(
    p_devices INTEGER[],
    p_from TIMESTAMP WITH TIME ZONE,
    p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[],
    p_commodity TEXT DEFAULT NULL,
    p_electrical_source TEXT DEFAULT NULL
)
RETURNS TABLE (
    bucket TIMESTAMP WITH TIME ZONE,
    device INTEGER,
    channel SMALLINT,
    tag VARCHAR(30),
    energy_wh DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    SELECT s.bucket, s.device, s.channel, s.tag, SUM(s.sum_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket < p_to
      AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (
          p_electrical_source IS NULL
          OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source
      )
    GROUP BY s.bucket, s.device, s.channel, s.tag
    ORDER BY s.bucket, s.device, s.channel, s.tag;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_report_channel_energy_totals(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[],
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (device INTEGER, channel SMALLINT, tag VARCHAR(30), total_wh DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT s.device, s.channel, s.tag, SUM(s.sum_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY s.device, s.channel, s.tag;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_daily_consumption(
    p_organization_id VARCHAR,
    p_devices         INTEGER[],
    p_tags            VARCHAR(30)[],
    p_from            TIMESTAMP WITH TIME ZONE,
    p_to              TIMESTAMP WITH TIME ZONE,
    p_tz              TEXT
)
RETURNS TABLE (
    device           INTEGER,
    channel          SMALLINT,
    tag              VARCHAR(30),
    local_day        DATE,
    local_day_start  TIMESTAMP WITH TIME ZONE,
    raw_total        DOUBLE PRECISION,
    max_bucket_value DOUBLE PRECISION,
    observed_buckets INTEGER,
    expected_buckets INTEGER
)
LANGUAGE sql STABLE
AS $$
    WITH expected AS (
        SELECT
            (bucket AT TIME ZONE p_tz)::DATE AS local_day,
            COUNT(*)::INTEGER AS expected_buckets
        FROM generate_series(
            p_from,
            p_to - INTERVAL '15 minutes',
            INTERVAL '15 minutes'
        ) AS bucket
        GROUP BY (bucket AT TIME ZONE p_tz)::DATE
    ),
    bucket_values AS (
        SELECT
            s.bucket,
            s.device,
            s.channel,
            s.tag,
            SUM(s.sum_val)::DOUBLE PRECISION AS bucket_value
        FROM device_em.energy_15min s
        JOIN device.list d
          ON d.id = s.device
         AND d.organization_id = p_organization_id
        WHERE s.device = ANY(p_devices)
          AND s.bucket >= p_from
          AND s.bucket < p_to
          AND s.tag = ANY(p_tags)
        GROUP BY s.bucket, s.device, s.channel, s.tag
    ),
    daily AS (
        SELECT
            b.device,
            b.channel,
            b.tag,
            (b.bucket AT TIME ZONE p_tz)::DATE AS local_day,
            SUM(b.bucket_value)::DOUBLE PRECISION AS raw_total,
            MAX(b.bucket_value)::DOUBLE PRECISION AS max_bucket_value,
            COUNT(DISTINCT b.bucket)::INTEGER AS observed_buckets
        FROM bucket_values b
        GROUP BY b.device, b.channel, b.tag, (b.bucket AT TIME ZONE p_tz)::DATE
    )
    SELECT
        d.device,
        d.channel,
        d.tag,
        d.local_day,
        d.local_day::TIMESTAMP AT TIME ZONE p_tz AS local_day_start,
        d.raw_total,
        d.max_bucket_value,
        d.observed_buckets,
        e.expected_buckets
    FROM daily d
    JOIN expected e USING (local_day)
    ORDER BY d.local_day, d.device, d.channel, d.tag;
$$;

DROP FUNCTION IF EXISTS device_em.fn_logical_energy_15min_rows(INT[], TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR(30)[]);
