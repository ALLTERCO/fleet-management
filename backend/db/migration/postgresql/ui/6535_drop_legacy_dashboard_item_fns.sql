--------------UP
-- Drop legacy v1 dashboard-item functions. v3 (6510 add, 6511 update,
-- 6512 remove, 6513 reorder) is the single source of truth — accepts
-- kind enum, populates the NOT NULL kind column added in 6504, and
-- maintains the back-compat integer `type` column internally.
--
-- TS call sites (DashboardRegistry, DashboardComponent) all route to v3
-- after this migration. The v1 functions had no remaining live callers
-- once Dashboard.AddItem was rewired in the same commit.
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_add(INT, INT, INT, INT, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_update(INT, INT, INT, INT, INT, VARCHAR, VARCHAR);
--------------DOWN
-- Restore 6200 v2 bodies. NOTE: the restored v1 add still does NOT set
-- `kind`, which violates the NOT NULL constraint added in 6504; only
-- useful when rolling back past 6504.
CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_add(
    p_dashboard INT,
    p_type INT,
    p_item INT,
    p_order INT DEFAULT 0,
    p_sub_item VARCHAR(250) DEFAULT NULL,
    p_size VARCHAR(3) DEFAULT '1x1'
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_id INT;
BEGIN
    INSERT INTO ui.dashboard_item (dashboard, type, item, "order", sub_item, size)
    VALUES (p_dashboard, p_type, p_item, p_order, p_sub_item, COALESCE(p_size, '1x1'))
    RETURNING id INTO r_id;
    RETURN r_id;
END;
$$;

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
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM ui.dashboard_item WHERE id = p_id;
    WITH cte AS (
        SELECT ui.fn_dashboard_item_add(
            p_dashboard, p_type, p_item, p_order, p_sub_item, p_size
        ) AS id
    )
    UPDATE ui.dashboard_item
       SET "order" = cte.id
      FROM cte
     WHERE ui.dashboard_item."order" = p_id;
END;
$$;
