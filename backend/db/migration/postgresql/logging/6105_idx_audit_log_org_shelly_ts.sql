--------------UP
-- Composite index for Location.EventReplay (Phase 3-follow-up).
--
-- The replay query filters by (organization_id, ts range) AND orders by
-- (shelly_id, ts). The existing idx_audit_log_org_ts handles the filter
-- but PG still has to re-sort the result set by shelly_id before
-- emitting. Adding (organization_id, shelly_id, ts) lets the planner
-- serve both the WHERE and the ORDER BY from the index — the sort
-- disappears.
--
-- Cost: one extra B-tree entry per audit row on the hot write path.
-- Audit volume is bounded by FM_AUDIT_FLUSH_INTERVAL_MS + the
-- BoundedQueue cap, so the marginal insert overhead is small and
-- predictable.
--
-- Existing idx_audit_log_org_ts stays — it remains the better choice
-- for queries that filter by organization_id but don't sort by
-- shelly_id (audit list views, billing rollups).

CREATE INDEX IF NOT EXISTS idx_audit_log_org_shelly_ts
    ON logging.audit_log (organization_id, shelly_id, ts);

--------------DOWN
DROP INDEX IF EXISTS logging.idx_audit_log_org_shelly_ts;
