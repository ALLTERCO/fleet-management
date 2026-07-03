--------------UP
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_remove_v3(INT, INT);
CREATE FUNCTION ui.fn_dashboard_item_remove_v3(
    p_dashboard INT,
    p_item_id   INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT;
BEGIN
    DELETE FROM ui.dashboard_item
     WHERE dashboard = p_dashboard AND id = p_item_id;
    GET DIAGNOSTICS r_count = ROW_COUNT;
    RETURN r_count > 0;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_remove_v3(INT, INT);
