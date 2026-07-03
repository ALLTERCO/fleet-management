--------------UP
CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_reorder(
    p_dashboard INT,
    p_item_ids  INT[]
)
RETURNS VOID
AS
$$
BEGIN
    -- Set "order" to the array index position for each item.
    -- Items not in the array keep their current order.
    -- Only updates items belonging to the specified dashboard.
    -- ORDINALITY is 1-based; subtract 1 to match existing 0-based order convention
    UPDATE ui.dashboard_item di
       SET "order" = arr.pos - 1
      FROM unnest(p_item_ids) WITH ORDINALITY AS arr(id, pos)
     WHERE di.id = arr.id
       AND di.dashboard = p_dashboard;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_reorder(INT, INT[]);
