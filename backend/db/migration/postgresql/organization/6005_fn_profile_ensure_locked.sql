--------------UP
-- Bootstrap race: 6004 used a non-transactional WHERE NOT EXISTS guard.
-- Two concurrent Dashboard.List calls (List + Get during one page load)
-- both pass the guard and both INSERT — producing duplicate
-- "Default Dashboard" rows on the first hit. Observed live on
-- test3-fleet (ids 2 and 3 created 4ms apart, same name + type).
-- Add a per-org pg_advisory_xact_lock so the read-then-insert is
-- serialised across sessions. Lock keyed on hashtext(p_id) — released
-- automatically at txn end. Same signature; no callers move.
DROP FUNCTION IF EXISTS organization.fn_profile_ensure(VARCHAR, VARCHAR, VARCHAR);
CREATE FUNCTION organization.fn_profile_ensure(
    p_id VARCHAR,
    p_default_dashboard_name VARCHAR DEFAULT NULL,
    p_default_dashboard_type VARCHAR DEFAULT 'classic'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Serialise concurrent bootstrap for the same org.
    PERFORM pg_advisory_xact_lock(hashtext('fn_profile_ensure:' || p_id));

    INSERT INTO organization.profile (id) VALUES (p_id)
    ON CONFLICT (id) DO NOTHING;

    IF p_default_dashboard_name IS NOT NULL THEN
        INSERT INTO ui.dashboard (organization_id, name, dashboard_type, is_default)
        SELECT p_id, p_default_dashboard_name, p_default_dashboard_type, TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM ui.dashboard WHERE organization_id = p_id
        );
    END IF;
END;
$$;
--------------DOWN
-- Restore 6004 body (no advisory lock, no is_default seed).
DROP FUNCTION IF EXISTS organization.fn_profile_ensure(VARCHAR, VARCHAR, VARCHAR);
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
