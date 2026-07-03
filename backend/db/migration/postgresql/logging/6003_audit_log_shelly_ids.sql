--------------UP
-- Bulk-op audit rows (e.g. waitingroom.acceptpendingbyexternalid with many
-- devices) cannot fit a single shelly_id column. Add a TEXT[] column that
-- holds zero-to-many shellyIDs per row, GIN-indexed for fast
-- `<id> = ANY(shelly_ids)` queries. No backfill — the audit table can hold
-- millions of rows under a 90-day retention policy, and a single-transaction
-- UPDATE would stall startup. fn_audit_log_query handles legacy rows by
-- also matching the singular shelly_id column (see 6003_fn_audit_log_query_shelly_ids).
ALTER TABLE logging.audit_log ADD COLUMN shelly_ids TEXT[];

CREATE INDEX idx_audit_log_shelly_ids ON logging.audit_log USING GIN (shelly_ids);

--------------DOWN
DROP INDEX IF EXISTS logging.idx_audit_log_shelly_ids;
ALTER TABLE logging.audit_log DROP COLUMN IF EXISTS shelly_ids;
