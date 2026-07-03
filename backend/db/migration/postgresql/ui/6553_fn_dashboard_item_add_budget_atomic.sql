--------------UP
-- CR-34: make the per-dashboard item-count budget check atomic with the
-- insert. Previously the check ran in application code (DashboardComponent
-- .#assertItemBudget) BEFORE the SQL INSERT, so two concurrent Item.Add
-- calls could each pass the check and each insert, exceeding the cap.
--
-- The fix moves the check into the SQL function with row-level locking:
--
--   1. SELECT FROM ui.dashboard WHERE id = p_dashboard FOR UPDATE acquires
--      a row lock on the parent dashboard. Concurrent calls on the SAME
--      dashboard block here until commit; concurrent calls on DIFFERENT
--      dashboards run in parallel.
--   2. SELECT COUNT(*) FROM ui.dashboard_item runs inside the lock window.
--   3. RAISE EXCEPTION if count + adding > p_max_items.
--   4. INSERT happens after the check, still inside the lock.
--
-- The cap is passed in as p_max_items so the tunable stays in env
-- (tuning.dashboardMaxItems). SQL doesn't need to know the value.

DROP FUNCTION IF EXISTS ui.fn_dashboard_item_add_v3(
    INT, VARCHAR, INT, VARCHAR, INT, INT, INT, INT, VARCHAR, JSONB, INT,
    VARCHAR, JSONB
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
    p_mobile_layout  JSONB   DEFAULT NULL,
    p_max_items      INT     DEFAULT 1000
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_id      INT;
    r_count   INT;
BEGIN
    -- Acquire row lock on the parent dashboard. Concurrent transactions
    -- on the same dashboard block here until our commit. Concurrent
    -- transactions on a DIFFERENT dashboard proceed without contention.
    PERFORM 1 FROM ui.dashboard WHERE id = p_dashboard FOR UPDATE;

    SELECT COUNT(*) INTO r_count
      FROM ui.dashboard_item
     WHERE dashboard = p_dashboard;

    IF r_count + 1 > p_max_items THEN
        RAISE EXCEPTION 'dashboard item budget exceeded: % items, max %',
            r_count, p_max_items
            USING ERRCODE = 'check_violation';
    END IF;

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

DROP FUNCTION IF EXISTS ui.fn_dashboard_item_add_bulk(INT, JSONB);
CREATE FUNCTION ui.fn_dashboard_item_add_bulk(
    p_dashboard INT,
    p_items     JSONB,
    p_max_items INT DEFAULT 1000
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_count       INT := 0;
    r_existing    INT;
    r_adding      INT;
    item          JSONB;
    r_base_order  INT;
BEGIN
    -- Same row lock as the single-add path. Holds for the duration of
    -- the loop so all inserts in this bulk call are accounted for under
    -- one budget snapshot.
    PERFORM 1 FROM ui.dashboard WHERE id = p_dashboard FOR UPDATE;

    r_adding := jsonb_array_length(p_items);

    SELECT COUNT(*) INTO r_existing
      FROM ui.dashboard_item
     WHERE dashboard = p_dashboard;

    IF r_existing + r_adding > p_max_items THEN
        RAISE EXCEPTION 'dashboard item budget exceeded: % existing + % adding > max %',
            r_existing, r_adding, p_max_items
            USING ERRCODE = 'check_violation';
    END IF;

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
            item->'mobileLayout',
            p_max_items
        );
        r_count := r_count + 1;
    END LOOP;
    RETURN r_count;
END;
$$;
--------------DOWN
-- Restore 6552's signatures (no budget check, p_max_items removed).
DROP FUNCTION IF EXISTS ui.fn_dashboard_item_add_v3(
    INT, VARCHAR, INT, VARCHAR, INT, INT, INT, INT, VARCHAR, JSONB, INT,
    VARCHAR, JSONB, INT
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

DROP FUNCTION IF EXISTS ui.fn_dashboard_item_add_bulk(INT, JSONB, INT);
CREATE FUNCTION ui.fn_dashboard_item_add_bulk(
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
