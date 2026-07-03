--------------UP
-- Monthly continuous aggregate over device_em.stats. Each row is a
-- (device, channel, tag, domain, year_month) summary with SUM (for
-- delta-tagged tags) + AVG/MIN/MAX (for instantaneous tags). Used by
-- "kWh in March 2025" / year-over-year reports — pre-aggregated so
-- the query layer touches 12 rows for a year, not millions.

CREATE MATERIALIZED VIEW IF NOT EXISTS device_em.mv__monthly_snapshots
WITH (timescaledb.continuous) AS
    SELECT
        time_bucket(INTERVAL '1 month', s.ts) AS year_month,
        s.device,
        s.channel,
        s.tag,
        s.domain,
        SUM(s.val) AS sum_val,
        AVG(s.val) AS avg_val,
        MIN(s.val) AS min_val,
        MAX(s.val) AS max_val,
        COUNT(*)::BIGINT AS row_count
    FROM device_em.stats s
    GROUP BY s.device, s.channel, s.tag, s.domain,
        time_bucket(INTERVAL '1 month', s.ts);

--------------DOWN
DROP MATERIALIZED VIEW IF EXISTS device_em.mv__monthly_snapshots;
