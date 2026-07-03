--------------UP
-- Monthly chunks + 90-day retention. The hypertable already exists from
-- 2001_audit_log.sql; this only changes chunking for new data and adds
-- a scheduled drop-old-chunks policy. Existing chunks keep their original
-- boundaries until they age out.
SELECT set_chunk_time_interval('logging.audit_log', INTERVAL '30 days');
SELECT add_retention_policy(
    'logging.audit_log',
    INTERVAL '90 days',
    if_not_exists => TRUE
);

-- Fail loud if policy did not register; silent no-op = unbounded table.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.jobs
        WHERE hypertable_name = 'audit_log'
          AND proc_name = 'policy_retention'
    ) THEN
        RAISE EXCEPTION 'retention policy failed to register on logging.audit_log';
    END IF;
END $$;
--------------DOWN
SELECT remove_retention_policy('logging.audit_log', if_exists => TRUE);
SELECT set_chunk_time_interval('logging.audit_log', INTERVAL '7 days');
