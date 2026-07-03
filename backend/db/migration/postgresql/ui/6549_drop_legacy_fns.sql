--------------UP
-- Phase 3: drop legacy SQL fns; TS no longer calls them.
DROP FUNCTION IF EXISTS ui.fn_dashboard_fetch(VARCHAR);
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_fetch(INT);
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_remove(INT, INT);
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_reorder(INT, INT[]);
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_set_size(INT, VARCHAR);
--------------DOWN
-- Forward-only after 6550 dropped the columns; restore via pg_dump.
SELECT 1;
