--------------UP
-- Phase 3: v3 fns write typed columns only. Legacy type/item/sub_item
-- still on the table but unused by writes. The next migration drops them.
-- Widget rows: prefer p_sub_item JSON when widget_kind/widget_config aren't
-- explicit, so legacy AddItem callers still work until they migrate.

CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_add_v3(
    p_dashboard      INT,
    p_kind           VARCHAR,
    p_ref_id         INT,
    p_order          INT DEFAULT 0,
    p_sub_item       VARCHAR DEFAULT NULL,
    p_size           VARCHAR DEFAULT '1x1',
    p_mobile_layout  JSONB DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_id INT;
    r_widget_kind VARCHAR;
    r_widget_config JSONB;
BEGIN
    IF p_kind IN ('ui_element','widget') THEN
        IF p_sub_item IS NOT NULL AND p_sub_item LIKE '{%' THEN
            r_widget_kind := COALESCE(NULLIF((p_sub_item::jsonb)->>'id', ''), 'clock_widget');
            r_widget_config := p_sub_item::jsonb;
        ELSE
            r_widget_kind := 'clock_widget';
        END IF;
    END IF;

    INSERT INTO ui.dashboard_item
        (dashboard, kind, "order", size, mobile_layout,
         device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
         widget_kind, widget_config)
    VALUES (
        p_dashboard, p_kind, p_order, COALESCE(p_size, '1x1'), p_mobile_layout,
        CASE WHEN p_kind IN ('device','entity') THEN p_ref_id END,
        CASE WHEN p_kind = 'entity'   THEN p_sub_item END,
        CASE WHEN p_kind = 'group'    THEN p_ref_id END,
        CASE WHEN p_kind = 'location' THEN p_ref_id END,
        CASE WHEN p_kind = 'tag'      THEN p_ref_id END,
        CASE WHEN p_kind = 'action'   THEN p_ref_id END,
        r_widget_kind,
        r_widget_config
    )
    RETURNING id INTO r_id;
    RETURN r_id;
END;
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_add_bulk(
    p_dashboard INT,
    p_items     JSONB
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT := 0;
    item JSONB;
    r_base_order INT;
BEGIN
    SELECT COALESCE(MAX("order"), -1) + 1
      INTO r_base_order
      FROM ui.dashboard_item
     WHERE dashboard = p_dashboard;
    FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        PERFORM ui.fn_dashboard_item_add_v3(
            p_dashboard,
            item->>'kind',
            (item->>'refId')::INT,
            COALESCE((item->>'order')::INT, r_base_order + r_count),
            item->>'subItem',
            COALESCE(item->>'size', '1x1'),
            item->'mobileLayout'
        );
        r_count := r_count + 1;
    END LOOP;
    RETURN r_count;
END;
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_set_all(
    p_dashboard INT,
    p_items     JSONB
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT := 0;
    item JSONB;
BEGIN
    DELETE FROM ui.dashboard_item WHERE dashboard = p_dashboard;
    FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        PERFORM ui.fn_dashboard_item_add_v3(
            p_dashboard,
            item->>'kind',
            (item->>'refId')::INT,
            COALESCE((item->>'order')::INT, r_count),
            item->>'subItem',
            COALESCE(item->>'size', '1x1'),
            item->'mobileLayout'
        );
        r_count := r_count + 1;
    END LOOP;
    RETURN r_count;
END;
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_update_v3(
    p_dashboard          INT,
    p_item_id            INT,
    p_size               VARCHAR DEFAULT NULL,
    p_sub_item           VARCHAR DEFAULT NULL,
    p_order              INT DEFAULT NULL,
    p_mobile_layout      JSONB DEFAULT NULL,
    p_clear_mobile_layout BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT;
    r_kind  VARCHAR;
BEGIN
    SELECT kind INTO r_kind FROM ui.dashboard_item
     WHERE dashboard = p_dashboard AND id = p_item_id;

    UPDATE ui.dashboard_item SET
        size          = COALESCE(p_size, size),
        "order"       = COALESCE(p_order, "order"),
        entity_sub_id = CASE WHEN r_kind = 'entity' AND p_sub_item IS NOT NULL
                             THEN p_sub_item ELSE entity_sub_id END,
        widget_config = CASE
            WHEN r_kind IN ('ui_element','widget')
                 AND p_sub_item IS NOT NULL
                 AND p_sub_item LIKE '{%'
            THEN p_sub_item::jsonb
            ELSE widget_config
        END,
        widget_kind   = CASE
            WHEN r_kind IN ('ui_element','widget')
                 AND p_sub_item IS NOT NULL
                 AND p_sub_item LIKE '{%'
            THEN COALESCE(NULLIF((p_sub_item::jsonb)->>'id', ''), widget_kind)
            ELSE widget_kind
        END,
        mobile_layout = CASE
            WHEN p_clear_mobile_layout THEN NULL
            WHEN p_mobile_layout IS NOT NULL THEN p_mobile_layout
            ELSE mobile_layout
        END
    WHERE dashboard = p_dashboard AND id = p_item_id;
    GET DIAGNOSTICS r_count = ROW_COUNT;
    RETURN r_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_clone(
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
BEGIN
    INSERT INTO ui.dashboard
        (organization_id, name, dashboard_type, group_id, location_id, tag_id)
    SELECT p_organization_id, p_name, dashboard_type,
           p_group_id, p_location_id, p_tag_id
      FROM ui.dashboard WHERE id = p_source_id
    RETURNING id INTO r_new_id;

    INSERT INTO ui.dashboard_item (
        dashboard, kind, "order", size, mobile_layout,
        device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
        widget_kind, widget_config
    )
    SELECT r_new_id, kind, "order", size, mobile_layout,
           device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
           widget_kind, widget_config
      FROM ui.dashboard_item WHERE dashboard = p_source_id;

    RETURN r_new_id;
END;
$$;
--------------DOWN
SELECT 1;
