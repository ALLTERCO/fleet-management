--------------UP
-- SQL ownership prevents a caller from widening an organization query with device ids.
CREATE FUNCTION device_em.fn_daily_consumption(
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

--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_daily_consumption(
    VARCHAR, INTEGER[], VARCHAR(30)[], TIMESTAMP WITH TIME ZONE,
    TIMESTAMP WITH TIME ZONE, TEXT
);
