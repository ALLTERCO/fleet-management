--------------UP
-- Org-ownership probe for cross-org access guards.
CREATE OR REPLACE FUNCTION ui.fn_dashboard_belongs_to_org(
    p_id INT,
    p_organization_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    SELECT EXISTS (
        SELECT 1 FROM ui.dashboard
        WHERE id = p_id AND organization_id = p_organization_id
    );
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_belongs_to_org(INT, VARCHAR);
