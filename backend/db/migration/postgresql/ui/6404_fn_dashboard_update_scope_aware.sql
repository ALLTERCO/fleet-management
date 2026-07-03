--------------UP
-- Scope-aware Update. Delegates cross-org validation to the shared
-- fn_dashboard_assert_scope_valid helper. NULL means "leave as-is"
-- (preserve current value via COALESCE); to explicitly clear a scope
-- axis, caller passes 0 which is translated to NULL below.
DROP FUNCTION IF EXISTS ui.fn_dashboard_update(INTEGER, VARCHAR, INT, VARCHAR);
DROP FUNCTION IF EXISTS ui.fn_dashboard_update(INTEGER, VARCHAR, VARCHAR);
CREATE FUNCTION ui.fn_dashboard_update(
    p_id              INTEGER,
    p_organization_id VARCHAR,
    p_name            VARCHAR(250) DEFAULT NULL,
    p_dashboard_type  VARCHAR(20)  DEFAULT NULL,
    p_location_id     INTEGER      DEFAULT NULL,
    p_group_id        INTEGER      DEFAULT NULL,
    p_tag_id          INTEGER      DEFAULT NULL,
    p_clear_scope     BOOLEAN      DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM ui.fn_dashboard_assert_scope_valid(
        p_organization_id, p_location_id, p_group_id, p_tag_id
    );

    UPDATE ui.dashboard SET
        name = COALESCE(p_name, name),
        dashboard_type = COALESCE(p_dashboard_type, dashboard_type),
        location_id = CASE
            WHEN p_clear_scope THEN p_location_id
            ELSE COALESCE(p_location_id, location_id)
        END,
        group_id = CASE
            WHEN p_clear_scope THEN p_group_id
            ELSE COALESCE(p_group_id, group_id)
        END,
        tag_id = CASE
            WHEN p_clear_scope THEN p_tag_id
            ELSE COALESCE(p_tag_id, tag_id)
        END,
        updated = CURRENT_TIMESTAMP
    WHERE id = p_id AND organization_id = p_organization_id;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_update(
    INTEGER, VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, INTEGER, BOOLEAN
);
CREATE FUNCTION ui.fn_dashboard_update(
    p_id INTEGER,
    p_name VARCHAR(250) DEFAULT NULL,
    p_group_id INT DEFAULT NULL,
    p_dashboard_type VARCHAR(20) DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE ui.dashboard SET
        name = COALESCE(p_name, name),
        group_id = COALESCE(p_group_id, group_id),
        dashboard_type = COALESCE(p_dashboard_type, dashboard_type),
        updated = CURRENT_TIMESTAMP
    WHERE id = p_id;
END;
$$;
