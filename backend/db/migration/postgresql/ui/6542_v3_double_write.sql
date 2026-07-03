--------------UP
-- Phase 1: v3 fns double-write to legacy + typed columns. Same signatures.
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
    r_type INT;
    r_widget_kind VARCHAR;
    r_widget_config JSONB;
BEGIN
    SELECT CASE p_kind
        WHEN 'device'     THEN 1
        WHEN 'entity'     THEN 2
        WHEN 'group'      THEN 3
        WHEN 'action'     THEN 4
        WHEN 'ui_element' THEN 5
        WHEN 'widget'     THEN 5
        WHEN 'location'   THEN 6
        WHEN 'tag'        THEN 7
    END INTO r_type;

    IF p_kind IN ('ui_element','widget') AND p_sub_item IS NOT NULL AND p_sub_item LIKE '{%' THEN
        r_widget_kind := COALESCE(NULLIF((p_sub_item::jsonb)->>'id', ''), 'clock_widget');
        r_widget_config := p_sub_item::jsonb;
    ELSIF p_kind IN ('ui_element','widget') THEN
        r_widget_kind := 'clock_widget';
    END IF;

    INSERT INTO ui.dashboard_item
        (dashboard, kind, type, item, "order", sub_item, size, mobile_layout,
         device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
         widget_kind, widget_config)
    VALUES (
        p_dashboard, p_kind, r_type, p_ref_id, p_order, p_sub_item,
        COALESCE(p_size, '1x1'), p_mobile_layout,
        CASE WHEN p_kind IN ('device','entity') THEN p_ref_id END,
        CASE WHEN p_kind = 'entity' THEN p_sub_item END,
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
    r_kind VARCHAR;
    r_ref INT;
    r_sub VARCHAR;
    r_order INT;
    r_size VARCHAR;
    r_mobile JSONB;
    r_base_order INT;
BEGIN
    SELECT COALESCE(MAX("order"), -1) + 1
      INTO r_base_order
      FROM ui.dashboard_item
     WHERE dashboard = p_dashboard;
    FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        r_kind := item->>'kind';
        r_ref := (item->>'refId')::INT;
        r_sub := item->>'subItem';
        r_order := COALESCE((item->>'order')::INT, r_base_order + r_count);
        r_size := COALESCE(item->>'size', '1x1');
        r_mobile := item->'mobileLayout';
        PERFORM ui.fn_dashboard_item_add_v3(
            p_dashboard, r_kind, r_ref, r_order, r_sub, r_size, r_mobile
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
--------------DOWN
-- No-op; restore via prior migrations 6510, 6514, 6515 if needed.
SELECT 1;
