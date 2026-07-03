--------------UP
-- Patch a single item: any of size, sub_item, order, mobile_layout.
-- NULL on a parameter = no change. To clear mobile_layout pass JSONB 'null'.
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_update_v3(
    INT, INT, VARCHAR, VARCHAR, INT, JSONB, BOOLEAN
);
CREATE FUNCTION ui.fn_dashboard_item_update_v3(
    p_dashboard          INT,
    p_item_id            INT,
    p_size               VARCHAR DEFAULT NULL,
    p_sub_item           VARCHAR DEFAULT NULL,
    p_order              INT DEFAULT NULL,
    p_mobile_layout      JSONB DEFAULT NULL,
    p_clear_mobile_layout BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT;
BEGIN
    UPDATE ui.dashboard_item SET
        size          = COALESCE(p_size,     size),
        sub_item      = COALESCE(p_sub_item, sub_item),
        "order"       = COALESCE(p_order,    "order"),
        mobile_layout = CASE
            WHEN p_clear_mobile_layout THEN NULL
            WHEN p_mobile_layout IS NOT NULL THEN p_mobile_layout
            ELSE mobile_layout
        END
    WHERE dashboard = p_dashboard AND id = p_item_id;
    GET DIAGNOSTICS r_count = ROW_COUNT;
    RETURN r_count > 0;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_update_v3(
    INT, INT, VARCHAR, VARCHAR, INT, JSONB, BOOLEAN
);
