--------------UP
-- v3 fns now take typed params per kind. No SQL JSON parsing, no FE-widget literals.
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_add_v3(
    INT, VARCHAR, INT, INT, VARCHAR, VARCHAR, JSONB
);
CREATE FUNCTION ui.fn_dashboard_item_add_v3(
    p_dashboard      INT,
    p_kind           VARCHAR,
    p_device_id      INT     DEFAULT NULL,
    p_entity_sub_id  VARCHAR DEFAULT NULL,
    p_group_id       INT     DEFAULT NULL,
    p_location_id    INT     DEFAULT NULL,
    p_tag_id         INT     DEFAULT NULL,
    p_action_id      INT     DEFAULT NULL,
    p_widget_kind    VARCHAR DEFAULT NULL,
    p_widget_config  JSONB   DEFAULT NULL,
    p_order          INT     DEFAULT 0,
    p_size           VARCHAR DEFAULT '1x1',
    p_mobile_layout  JSONB   DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_id INT;
BEGIN
    INSERT INTO ui.dashboard_item (
        dashboard, kind, "order", size, mobile_layout,
        device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
        widget_kind, widget_config
    ) VALUES (
        p_dashboard, p_kind, p_order, COALESCE(p_size, '1x1'), p_mobile_layout,
        p_device_id, p_entity_sub_id, p_group_id, p_location_id, p_tag_id, p_action_id,
        p_widget_kind, p_widget_config
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
            (item->>'deviceId')::INT,
            item->>'entitySubId',
            (item->>'groupId')::INT,
            (item->>'locationId')::INT,
            (item->>'tagId')::INT,
            (item->>'actionId')::INT,
            item->>'widgetKind',
            item->'widgetConfig',
            COALESCE((item->>'order')::INT, r_base_order + r_count),
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
            (item->>'deviceId')::INT,
            item->>'entitySubId',
            (item->>'groupId')::INT,
            (item->>'locationId')::INT,
            (item->>'tagId')::INT,
            (item->>'actionId')::INT,
            item->>'widgetKind',
            item->'widgetConfig',
            COALESCE((item->>'order')::INT, r_count),
            COALESCE(item->>'size', '1x1'),
            item->'mobileLayout'
        );
        r_count := r_count + 1;
    END LOOP;
    RETURN r_count;
END;
$$;

DROP FUNCTION IF EXISTS ui.fn_dashboard_item_update_v3(
    INT, INT, VARCHAR, VARCHAR, INT, JSONB, BOOLEAN
);
CREATE FUNCTION ui.fn_dashboard_item_update_v3(
    p_dashboard          INT,
    p_item_id            INT,
    p_size               VARCHAR DEFAULT NULL,
    p_entity_sub_id      VARCHAR DEFAULT NULL,
    p_widget_config      JSONB   DEFAULT NULL,
    p_order              INT     DEFAULT NULL,
    p_mobile_layout      JSONB   DEFAULT NULL,
    p_clear_mobile_layout BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT;
BEGIN
    UPDATE ui.dashboard_item SET
        size          = COALESCE(p_size, size),
        "order"       = COALESCE(p_order, "order"),
        entity_sub_id = COALESCE(p_entity_sub_id, entity_sub_id),
        widget_config = COALESCE(p_widget_config, widget_config),
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
--------------DOWN
SELECT 1;
