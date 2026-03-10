--------------UP
-- Update dashboard add to support analytics dashboards
DROP FUNCTION IF EXISTS ui.fn_dashboard_add(VARCHAR);
CREATE FUNCTION ui.fn_dashboard_add(
    p_name VARCHAR(250),
    p_group_id INT DEFAULT NULL,
    p_dashboard_type VARCHAR(20) DEFAULT 'classic'
)
RETURNS INT
AS
$$
DECLARE
    r_id INT;
BEGIN
    INSERT INTO ui.dashboard (name, group_id, dashboard_type)
    VALUES (p_name, p_group_id, p_dashboard_type)
    RETURNING id INTO r_id;

    -- If this is an analytics dashboard, create default settings
    IF p_dashboard_type = 'analytics' THEN
        INSERT INTO ui.dashboard_settings (dashboard_id) VALUES (r_id);
    END IF;

    RETURN r_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_add;
CREATE FUNCTION ui.fn_dashboard_add(
    p_name VARCHAR(250)
)
RETURNS INT
AS
$$
DECLARE
    r_id INT;
BEGIN
    INSERT INTO ui.dashboard (name) VALUES(p_name) RETURNING id INTO r_id;
    RETURN r_id;
END;
$$
LANGUAGE plpgsql;
