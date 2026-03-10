--------------UP
-- Update dashboard fetch to include new analytics columns
DROP FUNCTION IF EXISTS ui.fn_dashboard_fetch();
CREATE FUNCTION ui.fn_dashboard_fetch()
RETURNS TABLE (
    id INT,
    name VARCHAR(300),
    group_id INT,
    dashboard_type VARCHAR(20)
)
AS
$$
BEGIN
    RETURN QUERY (
        SELECT d.id, d.name, d.group_id, d.dashboard_type FROM ui.dashboard d
    );
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_fetch;
CREATE FUNCTION ui.fn_dashboard_fetch()
RETURNS TABLE (
    id INT,
    name VARCHAR(300)
)
AS
$$
BEGIN
    RETURN QUERY (
        SELECT d.id, d.name FROM ui.dashboard d
    );
END;
$$
LANGUAGE plpgsql;
