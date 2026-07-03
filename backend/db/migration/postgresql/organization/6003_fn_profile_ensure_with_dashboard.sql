--------------UP
-- Single org-bootstrap entry point: ensures profile row and (when name
-- provided) a default dashboard. Both inserts are idempotent.
-- DROP the 1-arg signature first — CREATE OR REPLACE with a new
-- argument list creates an overload, not a replacement; leaving both
-- would make 1-arg callers (fn_group_create, fn_location_create_v2, …)
-- ambiguous.
DROP FUNCTION IF EXISTS organization.fn_profile_ensure(VARCHAR);
CREATE FUNCTION organization.fn_profile_ensure(
    p_id VARCHAR,
    p_default_dashboard_name VARCHAR DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO organization.profile (id) VALUES (p_id)
    ON CONFLICT (id) DO NOTHING;

    IF p_default_dashboard_name IS NOT NULL THEN
        INSERT INTO ui.dashboard (organization_id, name, dashboard_type)
        SELECT p_id, p_default_dashboard_name, 'classic'
        WHERE NOT EXISTS (
            SELECT 1 FROM ui.dashboard WHERE organization_id = p_id
        );
    END IF;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_profile_ensure(VARCHAR, VARCHAR);
CREATE FUNCTION organization.fn_profile_ensure(p_id VARCHAR)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO organization.profile (id)
    VALUES (p_id)
    ON CONFLICT (id) DO NOTHING;
$$;
