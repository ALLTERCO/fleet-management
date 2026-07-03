--------------UP
-- Fast multi-select dashboard delete — two halves of one change:
--   1) Index ui.dashboard_item.dashboard. It had no index, so every dashboard
--      delete (and every per-dashboard item read) sequentially scanned the whole
--      dashboard_item table.
--   2) ui.fn_dashboard_remove_bulk — an org-scoped, set-based delete so the
--      client does ONE round-trip instead of N sequential Dashboard.Delete RPCs.
--      Only the caller org's dashboards are removed; returns the ids deleted.
CREATE INDEX IF NOT EXISTS idx_dashboard_item_dashboard
    ON ui.dashboard_item (dashboard);

-- Cascade FKs on dashboard_id whose only index leads with user_id: without
-- these, deleting a dashboard scans dashboard_pin / dashboard_order_user in full.
CREATE INDEX IF NOT EXISTS idx_dashboard_pin_dashboard_id
    ON ui.dashboard_pin (dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_order_user_dashboard_id
    ON ui.dashboard_order_user (dashboard_id);

CREATE OR REPLACE FUNCTION ui.fn_dashboard_remove_bulk(
    p_ids INTEGER[],
    p_organization_id VARCHAR
)
RETURNS TABLE(deleted_id INTEGER)
AS
$$
BEGIN
    -- Items first (child rows), scoped to the owned dashboards.
    DELETE FROM ui.dashboard_item
     WHERE dashboard IN (
        SELECT id FROM ui.dashboard
         WHERE id = ANY(p_ids) AND organization_id = p_organization_id
     );
    -- Then the dashboards themselves; RETURNING drives which ids were removed.
    RETURN QUERY
    DELETE FROM ui.dashboard d
     WHERE d.id = ANY(p_ids) AND d.organization_id = p_organization_id
     RETURNING d.id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_remove_bulk(INTEGER[], VARCHAR);
DROP INDEX IF EXISTS ui.idx_dashboard_order_user_dashboard_id;
DROP INDEX IF EXISTS ui.idx_dashboard_pin_dashboard_id;
DROP INDEX IF EXISTS ui.idx_dashboard_item_dashboard;
