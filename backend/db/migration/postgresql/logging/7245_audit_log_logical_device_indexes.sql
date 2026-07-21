--------------UP
-- LINT-IGNORE: concurrent-index -- Timescale hypertables reject CONCURRENTLY.
CREATE INDEX IF NOT EXISTS idx_audit_log_device
    ON logging.audit_log (device_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_devices
    ON logging.audit_log USING GIN (device_ids);

--------------DOWN
-- Forward-only logical identity migration.
