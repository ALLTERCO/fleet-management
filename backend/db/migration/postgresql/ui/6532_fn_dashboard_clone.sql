--------------UP
-- Deep-copy a dashboard within the same org. New row + duplicated items.
-- Settings deliberately NOT copied — clone is for layout, not config.
DROP FUNCTION IF EXISTS ui.fn_dashboard_clone(
    INT, VARCHAR, VARCHAR, INT, INT, INT
);
CREATE FUNCTION ui.fn_dashboard_clone(
    p_source_id       INT,
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_group_id        INT DEFAULT NULL,
    p_location_id     INT DEFAULT NULL,
    p_tag_id          INT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_new_id INT;
    src      RECORD;
BEGIN
    SELECT * INTO src FROM ui.dashboard
     WHERE id = p_source_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    INSERT INTO ui.dashboard
        (organization_id, name, dashboard_type, group_id, location_id, tag_id)
    VALUES (
        p_organization_id, p_name, src.dashboard_type,
        COALESCE(p_group_id,    src.group_id),
        COALESCE(p_location_id, src.location_id),
        COALESCE(p_tag_id,      src.tag_id)
    )
    RETURNING id INTO r_new_id;

    INSERT INTO ui.dashboard_item
        (dashboard, kind, type, item, "order", sub_item, size, mobile_layout)
    SELECT r_new_id, kind, type, item, "order", sub_item, size, mobile_layout
      FROM ui.dashboard_item
     WHERE dashboard = p_source_id;

    RETURN r_new_id;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_clone(
    INT, VARCHAR, VARCHAR, INT, INT, INT
);
