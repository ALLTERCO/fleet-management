--------------UP
-- Refactor fn_dashboard_add_scoped to use the shared validator. Behavior
-- unchanged; removes three duplicated IF/RAISE blocks.
CREATE OR REPLACE FUNCTION ui.fn_dashboard_add_scoped(
    p_organization_id VARCHAR,
    p_name            VARCHAR(300),
    p_dashboard_type  VARCHAR(20),
    p_location_id     INTEGER DEFAULT NULL,
    p_group_id        INTEGER DEFAULT NULL,
    p_tag_id          INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    name            VARCHAR,
    dashboard_type  VARCHAR,
    location_id     INTEGER,
    group_id        INTEGER,
    tag_id          INTEGER,
    created         TIMESTAMPTZ,
    updated         TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    r_id INTEGER;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    PERFORM ui.fn_dashboard_assert_scope_valid(
        p_organization_id, p_location_id, p_group_id, p_tag_id
    );

    INSERT INTO ui.dashboard (
        organization_id, name, dashboard_type,
        location_id, group_id, tag_id
    )
    VALUES (
        p_organization_id, p_name, p_dashboard_type,
        p_location_id, p_group_id, p_tag_id
    )
    RETURNING ui.dashboard.id INTO r_id;

    IF p_dashboard_type IN (
        'analytics','overview','energy','environment','control','safety'
    ) THEN
        INSERT INTO ui.dashboard_settings (dashboard_id) VALUES (r_id);
    END IF;

    RETURN QUERY
    SELECT d.id, d.organization_id, d.name, d.dashboard_type,
           d.location_id, d.group_id, d.tag_id, d.created, d.updated
    FROM ui.dashboard d
    WHERE d.id = r_id;
END;
$$;
--------------DOWN
-- Restore the inline-validator version from 6301_fn_dashboard_add_v3.sql.
CREATE OR REPLACE FUNCTION ui.fn_dashboard_add_scoped(
    p_organization_id VARCHAR,
    p_name            VARCHAR(300),
    p_dashboard_type  VARCHAR(20),
    p_location_id     INTEGER DEFAULT NULL,
    p_group_id        INTEGER DEFAULT NULL,
    p_tag_id          INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    name            VARCHAR,
    dashboard_type  VARCHAR,
    location_id     INTEGER,
    group_id        INTEGER,
    tag_id          INTEGER,
    created         TIMESTAMPTZ,
    updated         TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    r_id INTEGER;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    IF p_location_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.locations
        WHERE organization.locations.id = p_location_id
          AND organization.locations.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'location_id % not found in organization %',
            p_location_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'CrossOrgReference';
    END IF;
    IF p_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.groups
        WHERE organization.groups.id = p_group_id
          AND organization.groups.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'group_id % not found in organization %',
            p_group_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'CrossOrgReference';
    END IF;
    IF p_tag_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.tags
        WHERE organization.tags.id = p_tag_id
          AND organization.tags.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'tag_id % not found in organization %',
            p_tag_id, p_organization_id
            USING ERRCODE = '22023', DETAIL = 'CrossOrgReference';
    END IF;

    INSERT INTO ui.dashboard (
        organization_id, name, dashboard_type,
        location_id, group_id, tag_id
    )
    VALUES (
        p_organization_id, p_name, p_dashboard_type,
        p_location_id, p_group_id, p_tag_id
    )
    RETURNING ui.dashboard.id INTO r_id;

    IF p_dashboard_type IN (
        'analytics','overview','energy','environment','control','safety'
    ) THEN
        INSERT INTO ui.dashboard_settings (dashboard_id) VALUES (r_id);
    END IF;

    RETURN QUERY
    SELECT d.id, d.organization_id, d.name, d.dashboard_type,
           d.location_id, d.group_id, d.tag_id, d.created, d.updated
    FROM ui.dashboard d
    WHERE d.id = r_id;
END;
$$;
