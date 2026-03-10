--------------UP
-- Update dashboard update to support analytics dashboards
DROP FUNCTION IF EXISTS ui.fn_dashboard_update(INTEGER, VARCHAR);
CREATE FUNCTION ui.fn_dashboard_update(
    p_id INTEGER,
    p_name VARCHAR(250) DEFAULT NULL,
    p_group_id INT DEFAULT NULL,
    p_dashboard_type VARCHAR(20) DEFAULT NULL
)
RETURNS VOID
AS
$$
BEGIN
    UPDATE ui.dashboard SET
        name = COALESCE(p_name, name),
        group_id = COALESCE(p_group_id, group_id),
        dashboard_type = COALESCE(p_dashboard_type, dashboard_type),
        updated = CURRENT_TIMESTAMP
    WHERE id = p_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_update;
CREATE FUNCTION ui.fn_dashboard_update(
    p_id INTEGER,
    p_name VARCHAR(250)
)
RETURNS VOID
AS
$$
BEGIN
    UPDATE ui.dashboard SET name = p_name WHERE id = p_id;
END;
$$
LANGUAGE plpgsql;
