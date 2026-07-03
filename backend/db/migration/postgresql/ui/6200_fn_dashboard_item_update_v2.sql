--------------UP
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_update(INT, INT, INT, INT, INT, VARCHAR);
CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_update(
    p_id        INT,
    p_dashboard INT,
    p_type      INT,
    p_item      INT,
    p_order     INT DEFAULT 0,
    p_sub_item  VARCHAR(250) DEFAULT NULL,
    p_size      VARCHAR(3) DEFAULT '1x1'
)
RETURNS VOID
AS
$$
BEGIN
    DELETE FROM ui.dashboard_item
      WHERE id = p_id;

    WITH cte AS (
        SELECT
          ui.fn_dashboard_item_add(
            p_dashboard,
            p_type,
            p_item,
            p_order,
            p_sub_item,
            p_size
          ) AS id
    )
    UPDATE ui.dashboard_item
       SET "order" = cte.id
      FROM cte
     WHERE ui.dashboard_item."order" = p_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_update(INT, INT, INT, INT, INT, VARCHAR, VARCHAR);
CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_update(
    p_id        INT,
    p_dashboard INT,
    p_type      INT,
    p_item      INT,
    p_order     INT DEFAULT 0,
    p_sub_item  VARCHAR(250) DEFAULT NULL
)
RETURNS VOID
AS
$$
BEGIN
    DELETE FROM ui.dashboard_item
      WHERE id = p_id;

    WITH cte AS (
        SELECT
          ui.fn_dashboard_item_add(
            p_dashboard,
            p_type,
            p_item,
            p_order,
            p_sub_item
          ) AS id
    )
    UPDATE ui.dashboard_item
       SET "order" = cte.id
      FROM cte
     WHERE ui.dashboard_item."order" = p_id;
END;
$$
LANGUAGE plpgsql;