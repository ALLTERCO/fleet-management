--------------UP
-- Replace all items atomically. p_items: JSONB array of
-- {kind, refId, order?, subItem?, size?, mobileLayout?}.
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_set_all(INT, JSONB);
CREATE FUNCTION ui.fn_dashboard_item_set_all(
    p_dashboard INT,
    p_items     JSONB
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT := 0;
    item    JSONB;
    r_type  INT;
BEGIN
    DELETE FROM ui.dashboard_item WHERE dashboard = p_dashboard;
    FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        SELECT CASE item->>'kind'
            WHEN 'device'     THEN 1
            WHEN 'entity'     THEN 2
            WHEN 'group'      THEN 3
            WHEN 'action'     THEN 4
            WHEN 'ui_element' THEN 5
        END INTO r_type;
        INSERT INTO ui.dashboard_item
            (dashboard, kind, type, item, "order", sub_item, size, mobile_layout)
        VALUES (
            p_dashboard,
            item->>'kind',
            r_type,
            (item->>'refId')::INT,
            COALESCE((item->>'order')::INT, r_count),
            item->>'subItem',
            COALESCE(item->>'size', '1x1'),
            item->'mobileLayout'
        );
        r_count := r_count + 1;
    END LOOP;
    RETURN r_count;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_set_all(INT, JSONB);
