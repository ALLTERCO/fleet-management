--------------UP
-- Drop the legacy device.status-sourced ENERGY continuous aggregates. Energy is
-- served from the 15-minute rollup (device_em.energy_15min); neither of these is
-- read by the app or reports. (mv__em_total_act_5_min_history_20_days was read
-- only by the optional Grafana addon, whose templates are updated separately.)
-- Dropping a continuous aggregate also removes its refresh/compression jobs.
--
-- KEPT (NOT dropped here): device.mv__status_presence — that is presence, not
-- energy; its future is pending the presence research.
--
-- IF EXISTS for tenant drift (some tenants already lack one or both).
DROP MATERIALIZED VIEW IF EXISTS device.mv__em_total_act_5_min;
DROP MATERIALIZED VIEW IF EXISTS device.mv__em_total_act_5_min_history_20_days;
--------------DOWN
-- Best-effort rollback: recreate both continuous aggregates + policies verbatim
-- (origin 5000/5001).
SET search_path TO device, public;

CREATE MATERIALIZED VIEW IF NOT EXISTS device.mv__em_total_act_5_min
WITH (timescaledb.continuous) AS
    SELECT
        time_bucket(INTERVAL '5 min', s.ts) as bucket,
        s.id,
        CASE
            WHEN
                s.field_group IN (
                    'emdata:*.total_act',
                    'emdata:*.a_total_act_energy',
                    'emdata:*.b_total_act_energy',
                    'emdata:*.c_total_act_energy',
                    'em1data:*.total_act_energy',
                    'switch:*.aenergy.total'
                )
            THEN 'in'
            ELSE 'out'
        END metric,
        MAX(s.value) watts
    FROM
        device.status s
    WHERE
        s.field_group IN (
            'emdata:*.total_act',
            'emdata:*.a_total_act_energy',
            'emdata:*.b_total_act_energy',
            'emdata:*.c_total_act_energy',
            'emdata:*.total_act_ret',
            'emdata:*.a_total_act_ret_energy',
            'emdata:*.b_total_act_ret_energy',
            'emdata:*.c_total_act_ret_energy',
            'em1data:*.total_act_energy',
            'em1data:*.total_act_energy_ret',
            'switch:*.ret_aenergy.total',
            'switch:*.aenergy.total'
        )
    GROUP BY
        bucket,
        s.id,
        metric;
SELECT set_chunk_time_interval('device.mv__em_total_act_5_min', INTERVAL '20 days');
SELECT add_continuous_aggregate_policy(
    'device.mv__em_total_act_5_min',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '1 second',
    schedule_interval => INTERVAL '2 min',
    if_not_exists => true
);

CREATE MATERIALIZED VIEW IF NOT EXISTS device.mv__em_total_act_5_min_history_20_days
WITH (timescaledb.continuous) AS
    SELECT
        time_bucket(INTERVAL '5 min', s.ts) as bucket,
        s.id,
        s.field,
        s.field_group,
        MAX(s.value) value_max,
        AVG(s.value) value_avg,
        MIN(s.value) value_min,
        MAX(s.prev_value) prev_val_max,
        AVG(s.prev_value) prev_val_avg,
        MIN(s.prev_value) prev_val_min
    FROM
        device.status s
    WHERE
        s.field_group IN (
            'emdata:*.total_act',
            'emdata:*.a_total_act_energy',
            'emdata:*.b_total_act_energy',
            'emdata:*.c_total_act_energy',
            'emdata:*.total_act_ret',
            'emdata:*.a_total_act_ret_energy',
            'emdata:*.b_total_act_ret_energy',
            'emdata:*.c_total_act_ret_energy',
            'em1data:*.total_act_energy',
            'em1data:*.total_act_energy_ret',
            'switch:*.ret_aenergy.total',
            'switch:*.aenergy.total',
            'switch:*.voltage',
            'switch:*.apower',
            'switch:*.temperature.tC',
            'switch:*.current',
            'switch:*.temperature.tF'
        )
    GROUP BY
        bucket,
        s.id,
        s.field_group,
        s.field;
SELECT set_chunk_time_interval('device.mv__em_total_act_5_min_history_20_days', INTERVAL '20 days');
SELECT add_continuous_aggregate_policy(
    'device.mv__em_total_act_5_min_history_20_days',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '1 second',
    schedule_interval => INTERVAL '2 min',
    if_not_exists => true
);
