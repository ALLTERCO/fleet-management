--------------UP
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_add(INT, INT, INT, INT, VARCHAR);
CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_add(
    p_dashboard INT,
    p_type INT,
    p_item INT,
    p_order INT DEFAULT 0,
    p_sub_item VARCHAR(250) DEFAULT NULL,
    p_size VARCHAR(3) DEFAULT '1x1'
)
RETURNS INT
AS
$$
DECLARE
   r_id INT;
BEGIN
    INSERT INTO ui.dashboard_item (dashboard, type, item, "order", sub_item, size)
    VALUES (p_dashboard, p_type, p_item, p_order, p_sub_item, COALESCE(p_size, '1x1'))
    RETURNING id INTO r_id;
    RETURN r_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_add(INT, INT, INT, INT, VARCHAR, VARCHAR);
CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_add(
    p_dashboard INT,
    p_type INT,
    p_item INT,
    p_order INT DEFAULT 0,
    p_sub_item VARCHAR(250) DEFAULT NULL
)
RETURNS INT
AS
$$
DECLARE
   r_id INT;
BEGIN
    INSERT INTO ui.dashboard_item (dashboard, type, item, "order", sub_item)
    VALUES (p_dashboard, p_type, p_item, p_order, p_sub_item)
    RETURNING id INTO r_id;
    RETURN r_id;
END;
$$
LANGUAGE plpgsql;