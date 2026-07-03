--------------UP
SELECT set_chunk_time_interval(
    'device_em.mv__monthly_snapshots',
    INTERVAL '1 year'
);

SELECT add_continuous_aggregate_policy(
    'device_em.mv__monthly_snapshots',
    start_offset      => INTERVAL '3 months',
    end_offset        => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists     => true
);
--------------DOWN
SELECT 1;
