--------------UP
-- Partial indexes for the per-tick cleanup sweeps + report retention. Each
-- predicate was a full-table scan every interval, which does not scale with
-- many devices/orgs. The partial WHERE matches the sweep's stable predicate so
-- only live rows are indexed.
CREATE INDEX IF NOT EXISTS device_ingress_credential_expiry_idx
    ON organization.device_ingress_credential (not_after)
    WHERE state IN ('active', 'pending') AND not_after IS NOT NULL;

CREATE INDEX IF NOT EXISTS device_ingress_setup_session_expiry_idx
    ON organization.device_ingress_setup_session (expires_at)
    WHERE status IN ('planned', 'partial');

CREATE INDEX IF NOT EXISTS device_ingress_connection_stale_idx
    ON organization.device_ingress_connection (created_at)
    WHERE result = 'accepted' AND disconnected_at IS NULL;

CREATE INDEX IF NOT EXISTS report_instances_timestamp_idx
    ON logging.report_instances ("timestamp");
--------------DOWN
DROP INDEX IF EXISTS organization.device_ingress_credential_expiry_idx;
DROP INDEX IF EXISTS organization.device_ingress_setup_session_expiry_idx;
DROP INDEX IF EXISTS organization.device_ingress_connection_stale_idx;
DROP INDEX IF EXISTS logging.report_instances_timestamp_idx;
