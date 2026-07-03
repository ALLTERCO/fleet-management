--------------UP
-- v3 accepts kind enum + mobile_layout JSONB + returns new item row.
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_add_v3(
    INT, VARCHAR, INT, INT, VARCHAR, VARCHAR, JSONB
);
CREATE FUNCTION ui.fn_dashboard_item_add_v3(
    p_dashboard      INT,
    p_kind           VARCHAR,
    p_ref_id         INT,
    p_order          INT DEFAULT 0,
    p_sub_item       VARCHAR DEFAULT NULL,
    p_size           VARCHAR DEFAULT '1x1',
    p_mobile_layout  JSONB DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_id INT;
    r_type INT;
BEGIN
    -- Map enum kind back to legacy integer `type` for back-compat columns.
    SELECT CASE p_kind
        WHEN 'device'     THEN 1
        WHEN 'entity'     THEN 2
        WHEN 'group'      THEN 3
        WHEN 'action'     THEN 4
        WHEN 'ui_element' THEN 5
    END INTO r_type;

    INSERT INTO ui.dashboard_item
        (dashboard, kind, type, item, "order", sub_item, size, mobile_layout)
    VALUES
        (p_dashboard, p_kind, r_type, p_ref_id, p_order, p_sub_item,
         COALESCE(p_size, '1x1'), p_mobile_layout)
    RETURNING id INTO r_id;
    RETURN r_id;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_add_v3(
    INT, VARCHAR, INT, INT, VARCHAR, VARCHAR, JSONB
);
