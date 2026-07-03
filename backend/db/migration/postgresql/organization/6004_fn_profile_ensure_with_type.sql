--------------UP
-- Adds p_default_dashboard_type so the bootstrapped dashboard type is
-- deploy-time-configurable via FM_DEFAULT_DASHBOARD_TYPE (not hardcoded).
DROP FUNCTION IF EXISTS organization.fn_profile_ensure(VARCHAR, VARCHAR);
CREATE FUNCTION organization.fn_profile_ensure(
    p_id VARCHAR,
    p_default_dashboard_name VARCHAR DEFAULT NULL,
    p_default_dashboard_type VARCHAR DEFAULT 'classic'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO organization.profile (id) VALUES (p_id)
    ON CONFLICT (id) DO NOTHING;

    IF p_default_dashboard_name IS NOT NULL THEN
        INSERT INTO ui.dashboard (organization_id, name, dashboard_type)
        SELECT p_id, p_default_dashboard_name, p_default_dashboard_type
        WHERE NOT EXISTS (
            SELECT 1 FROM ui.dashboard WHERE organization_id = p_id
        );
    END IF;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_profile_ensure(VARCHAR, VARCHAR, VARCHAR);
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
