--------------UP
-- Compress audit_log chunks older than 7 days. Audit reads are usually
-- recent (incident triage, last-N-days dashboards) and we keep 90 days
-- under retention — so the bulk of stored data is read-rarely and worth
-- compressing. Segment by event_type because most queries filter on it
-- via idx_audit_log_event_type.
ALTER TABLE logging.audit_log
    SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'event_type',
        timescaledb.compress_orderby = 'ts DESC'
    );

SELECT add_compression_policy(
    'logging.audit_log',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Fail loud if policy did not register; silent no-op = uncompressed table.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.jobs
        WHERE hypertable_name = 'audit_log'
          AND proc_name = 'policy_compression'
    ) THEN
        RAISE EXCEPTION 'compression policy failed to register on logging.audit_log';
    END IF;
END $$;
--------------DOWN
SELECT remove_compression_policy('logging.audit_log', if_exists => TRUE);
ALTER TABLE logging.audit_log SET (timescaledb.compress = FALSE);
