--------------UP
-- Dashboard ownership is established by the canonical scoped insert, in the
-- same transaction as the dashboard row. The extra argument is optional for
-- database callers, while the application always supplies its authenticated
-- user id.

-- LINT-IGNORE: additive-only — PostgreSQL identifies functions by input signature.
DROP FUNCTION IF EXISTS ui.fn_dashboard_add_scoped(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER
);

CREATE FUNCTION ui.fn_dashboard_add_scoped(
    p_organization_id VARCHAR,
    p_name            VARCHAR(300),
    p_dashboard_type  VARCHAR(20),
    p_location_id     INTEGER DEFAULT NULL,
    p_group_id        INTEGER DEFAULT NULL,
    p_tag_id          INTEGER DEFAULT NULL,
    p_owner_user_id   VARCHAR(120) DEFAULT NULL
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
        organization_id, owner_user_id, name, dashboard_type,
        location_id, group_id, tag_id
    )
    VALUES (
        p_organization_id, p_owner_user_id, p_name, p_dashboard_type,
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

-- LINT-IGNORE: additive-only — PostgreSQL identifies functions by input signature.
DROP FUNCTION IF EXISTS ui.fn_dashboard_clone(
    INT, VARCHAR, VARCHAR, INT, INT, INT
);

CREATE FUNCTION ui.fn_dashboard_clone(
    p_source_id       INTEGER,
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_group_id        INTEGER DEFAULT NULL,
    p_location_id     INTEGER DEFAULT NULL,
    p_tag_id          INTEGER DEFAULT NULL,
    p_owner_user_id   VARCHAR(120) DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    r_new_id INTEGER;
BEGIN
    INSERT INTO ui.dashboard (
        organization_id, owner_user_id, name, dashboard_type,
        group_id, location_id, tag_id
    )
    SELECT p_organization_id, p_owner_user_id, p_name, dashboard_type,
           p_group_id, p_location_id, p_tag_id
      FROM ui.dashboard
     WHERE id = p_source_id
    RETURNING id INTO r_new_id;

    INSERT INTO ui.dashboard_item (
        dashboard, kind, "order", size, mobile_layout,
        device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
        widget_kind, widget_config
    )
    SELECT r_new_id, kind, "order", size, mobile_layout,
           device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
           widget_kind, widget_config
      FROM ui.dashboard_item
     WHERE dashboard = p_source_id;

    RETURN r_new_id;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_clone(
    INTEGER, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, VARCHAR
);

CREATE FUNCTION ui.fn_dashboard_clone(
    p_source_id       INTEGER,
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_group_id        INTEGER DEFAULT NULL,
    p_location_id     INTEGER DEFAULT NULL,
    p_tag_id          INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    r_new_id INTEGER;
BEGIN
    INSERT INTO ui.dashboard
        (organization_id, name, dashboard_type, group_id, location_id, tag_id)
    SELECT p_organization_id, p_name, dashboard_type,
           p_group_id, p_location_id, p_tag_id
      FROM ui.dashboard
     WHERE id = p_source_id
    RETURNING id INTO r_new_id;

    INSERT INTO ui.dashboard_item (
        dashboard, kind, "order", size, mobile_layout,
        device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
        widget_kind, widget_config
    )
    SELECT r_new_id, kind, "order", size, mobile_layout,
           device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
           widget_kind, widget_config
      FROM ui.dashboard_item
     WHERE dashboard = p_source_id;

    RETURN r_new_id;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_add_scoped(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, VARCHAR
);

CREATE FUNCTION ui.fn_dashboard_add_scoped(
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
