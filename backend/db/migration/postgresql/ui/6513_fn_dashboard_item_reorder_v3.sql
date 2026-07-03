--------------UP
-- Atomic reorder: assigns 0..N-1 to the given itemIds in order.
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_reorder_v3(INT, INT[]);
CREATE FUNCTION ui.fn_dashboard_item_reorder_v3(
    p_dashboard INT,
    p_item_ids  INT[]
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT := 0;
    i INT;
BEGIN
    FOR i IN 1 .. COALESCE(array_length(p_item_ids, 1), 0) LOOP
        UPDATE ui.dashboard_item
           SET "order" = i - 1
         WHERE dashboard = p_dashboard AND id = p_item_ids[i];
        IF FOUND THEN r_count := r_count + 1; END IF;
    END LOOP;
    RETURN r_count;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_reorder_v3(INT, INT[]);
