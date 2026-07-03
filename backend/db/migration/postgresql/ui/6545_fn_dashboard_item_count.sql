--------------UP
-- Replaces fn_dashboard_item_fetch's only remaining caller (budget check).
CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_count(
    p_dashboard INT
)
RETURNS INT
LANGUAGE sql
AS $$
    SELECT COUNT(*)::INT FROM ui.dashboard_item WHERE dashboard = p_dashboard;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_count(INT);
