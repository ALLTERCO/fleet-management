--------------UP
DROP FUNCTION IF EXISTS ui.fn_dashboard_get_default(VARCHAR);
CREATE FUNCTION ui.fn_dashboard_get_default(p_organization_id VARCHAR)
RETURNS TABLE (id INT)
LANGUAGE sql
AS $$
    SELECT id FROM ui.dashboard
     WHERE organization_id = p_organization_id AND is_default = TRUE
     LIMIT 1;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_set_default(INT, VARCHAR);
CREATE FUNCTION ui.fn_dashboard_set_default(
    p_dashboard_id    INT,
    p_organization_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT;
BEGIN
    -- Atomic clear-then-set within a single transaction.
    UPDATE ui.dashboard SET is_default = FALSE
     WHERE organization_id = p_organization_id AND is_default = TRUE;
    UPDATE ui.dashboard SET is_default = TRUE
     WHERE id = p_dashboard_id AND organization_id = p_organization_id;
    GET DIAGNOSTICS r_count = ROW_COUNT;
    RETURN r_count > 0;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_clear_default(VARCHAR);
CREATE FUNCTION ui.fn_dashboard_clear_default(p_organization_id VARCHAR)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT;
BEGIN
    UPDATE ui.dashboard SET is_default = FALSE
     WHERE organization_id = p_organization_id AND is_default = TRUE;
    GET DIAGNOSTICS r_count = ROW_COUNT;
    RETURN r_count;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_get_default(VARCHAR);
DROP FUNCTION IF EXISTS ui.fn_dashboard_set_default(INT, VARCHAR);
DROP FUNCTION IF EXISTS ui.fn_dashboard_clear_default(VARCHAR);
