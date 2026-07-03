--------------UP
CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_set_size(
    p_id INT,
    p_size VARCHAR(3)
)
RETURNS VOID
AS
$$
BEGIN
    UPDATE ui.dashboard_item
       SET size = p_size
     WHERE id = p_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_set_size;