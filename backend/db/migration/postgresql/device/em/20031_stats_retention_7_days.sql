--------------UP
-- Shrink raw retention from 31 to 7 days.
--
-- device_em.stats holds the 15s live/debug series AND the 1-min em-sync series.
-- Billing is device_em.energy_15min (kept long), untouched by raw retention.
-- The 15s live series is ~80% of raw volume, so 7 days is the large storage win
-- (at 2k EM devices, roughly 96 GB -> 41 GB per tenant).
--
-- Retention stays GATED behind the rollup (device_em.fn_drop_rolled_up_stats,
-- 6774), so raw is never dropped before it is rolled up. Only the daily job's
-- retention_days config changes; the gate function and the plain policy do not.
--
-- Readers affected: 'minute' and 'five_minutes' reports read raw
-- (device_em.fn_report_stats_paged); after this they cover the last 7 days.
-- Every coarser granularity reads the 15-min rollup and is unaffected.
SET search_path TO device_em, public;
DO $$
DECLARE
    v_job_id INT;
BEGIN
    FOR v_job_id IN
        SELECT job_id FROM timescaledb_information.jobs
        WHERE proc_schema = 'device_em' AND proc_name = 'job_retain_stats'
    LOOP
        PERFORM alter_job(v_job_id, config => '{"retention_days": 7}'::jsonb);
    END LOOP;
END $$;

--------------DOWN
-- Restore the 31-day retention window.
SET search_path TO device_em, public;
DO $$
DECLARE
    v_job_id INT;
BEGIN
    FOR v_job_id IN
        SELECT job_id FROM timescaledb_information.jobs
        WHERE proc_schema = 'device_em' AND proc_name = 'job_retain_stats'
    LOOP
        PERFORM alter_job(v_job_id, config => '{"retention_days": 31}'::jsonb);
    END LOOP;
END $$;
