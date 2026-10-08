--------------UP
-- fn_profile_ensure is called from many write paths, including ingress audit
-- flushing. The profile already exists for the steady-state case, so taking a
-- per-org advisory lock before ON CONFLICT DO NOTHING serialises unrelated
-- work for no effect. Keep the lock for first bootstrap/default-dashboard
-- creation, but return lock-free when all requested state already exists.
CREATE OR REPLACE FUNCTION organization.fn_profile_ensure(
    p_id VARCHAR,
    p_default_dashboard_name VARCHAR DEFAULT NULL,
    p_default_dashboard_type VARCHAR DEFAULT 'classic'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM organization.profile WHERE id = p_id
    ) AND (
        p_default_dashboard_name IS NULL
        OR EXISTS (
            SELECT 1
              FROM ui.dashboard
             WHERE organization_id = p_id
        )
    ) THEN
        RETURN;
    END IF;

    -- Serialise only the bootstrap path, then re-check through conflict-safe
    -- writes because another session may have completed while we waited.
    PERFORM pg_advisory_xact_lock(hashtext('fn_profile_ensure:' || p_id));

    INSERT INTO organization.profile (id) VALUES (p_id)
    ON CONFLICT (id) DO NOTHING;

    IF p_default_dashboard_name IS NOT NULL THEN
        INSERT INTO ui.dashboard (
            organization_id,
            name,
            dashboard_type,
            is_default
        )
        SELECT
            p_id,
            p_default_dashboard_name,
            p_default_dashboard_type,
            TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM ui.dashboard WHERE organization_id = p_id
        );
    END IF;
END;
$$;
--------------DOWN
CREATE OR REPLACE FUNCTION organization.fn_profile_ensure(
    p_id VARCHAR,
    p_default_dashboard_name VARCHAR DEFAULT NULL,
    p_default_dashboard_type VARCHAR DEFAULT 'classic'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('fn_profile_ensure:' || p_id));

    INSERT INTO organization.profile (id) VALUES (p_id)
    ON CONFLICT (id) DO NOTHING;

    IF p_default_dashboard_name IS NOT NULL THEN
        INSERT INTO ui.dashboard (
            organization_id,
            name,
            dashboard_type,
            is_default
        )
        SELECT
            p_id,
            p_default_dashboard_name,
            p_default_dashboard_type,
            TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM ui.dashboard WHERE organization_id = p_id
        );
    END IF;
END;
$$;
