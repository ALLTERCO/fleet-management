--------------UP
-- Drop the legacy energy continuous aggregates. They are dead weight: the
-- energy dashboard and reports read the 15-minute rollup
-- (device_em.energy_15min) and raw device_em.stats, never these. Each carries a
-- TimescaleDB refresh job (5 min / hourly) that, multiplied across every tenant
-- database on one shared TimescaleDB, fails-and-retries and pins the box CPU.
-- Dropping a continuous aggregate also removes its refresh/compression jobs.
--
-- IF EXISTS: tenants have drifted (some already lack one or more of these), so
-- each drop must be a no-op when the view is absent.
--
-- Kept: device.mv__status_presence (presence feature, not energy) and the
-- device.status-sourced device.mv__em_total_act_5_min_history_20_days, which the
-- provisioned Grafana energy panels still read — that one is dropped only after
-- those panels are migrated off it.
--
-- mv__stats_1h was created outside the migration tree on some tenants; it is
-- dropped here by name (IF EXISTS) so drifted tenants converge. It has no repo
-- definition, so DOWN cannot restore it.
DROP MATERIALIZED VIEW IF EXISTS device_em.mv__total_energy_5_min;
DROP MATERIALIZED VIEW IF EXISTS device_em.mv__total_energy_24_h;
DROP MATERIALIZED VIEW IF EXISTS device_em.mv__monthly_snapshots;
DROP MATERIALIZED VIEW IF EXISTS device_em.mv__stats_1h;
--------------DOWN
-- Best-effort rollback: recreate the repo-defined continuous aggregates and
-- their policies verbatim (origin 5000/5001/5100/5101). mv__stats_1h has no
-- repo definition and cannot be restored here. search_path includes public so
-- time_bucket resolves (later em migrations leave it at device_em).
SET search_path TO device_em, public;

CREATE MATERIALIZED VIEW IF NOT EXISTS device_em.mv__total_energy_5_min
WITH (timescaledb.continuous) AS
    SELECT
        time_bucket(INTERVAL '5 min', s.ts) as ts,
        s.device,
        s.phase,
        s.channel,
        s.tag,
        SUM(s.val) val
    FROM
        device_em.stats s
    WHERE
        s.tag = 'total_act_energy'
    GROUP BY s.device, s.phase, s.channel, s.tag, time_bucket(INTERVAL '5 min', s.ts)
    ORDER BY s.device, s.phase, s.channel, s.tag, time_bucket(INTERVAL '5 min', s.ts);
SELECT set_chunk_time_interval('device_em.mv__total_energy_5_min', INTERVAL '4 months');
SELECT add_continuous_aggregate_policy(
    'device_em.mv__total_energy_5_min',
    start_offset => INTERVAL '4 months',
    end_offset => INTERVAL '1 second',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => true
);

CREATE MATERIALIZED VIEW IF NOT EXISTS device_em.mv__total_energy_24_h
WITH (timescaledb.continuous) AS
    SELECT
        time_bucket(INTERVAL '24 hours', s.ts) as ts,
        s.device,
        s.phase,
        s.channel,
        s.tag,
        SUM(s.val) val
    FROM
        device_em.stats s
    WHERE
        s.tag = 'total_act_energy'
    GROUP BY s.device, s.phase, s.channel, s.tag, time_bucket(INTERVAL '24 hours', s.ts)
    ORDER BY s.device, s.phase, s.channel, s.tag, time_bucket(INTERVAL '24 hours', s.ts);
SELECT set_chunk_time_interval('device_em.mv__total_energy_24_h', INTERVAL '1 year');
SELECT add_continuous_aggregate_policy(
    'device_em.mv__total_energy_24_h',
    start_offset => INTERVAL '4 months',
    end_offset => INTERVAL '1 second',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => true
);

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
SELECT set_chunk_time_interval('device_em.mv__monthly_snapshots', INTERVAL '1 year');
SELECT add_continuous_aggregate_policy(
    'device_em.mv__monthly_snapshots',
    start_offset      => INTERVAL '3 months',
    end_offset        => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists     => true
);
