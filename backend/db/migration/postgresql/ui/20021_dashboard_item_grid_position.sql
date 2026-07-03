--------------UP
-- Free 2D placement: dashboard items gain grid coordinates (grid_x, grid_y)
-- and a grid footprint (grid_w, grid_h). All nullable; existing rows get
-- w/h backfilled from the legacy `size` string but keep x/y NULL so the
-- frontend grid engine auto-flows them by `order` on first load.
ALTER TABLE ui.dashboard_item
    ADD COLUMN IF NOT EXISTS grid_x INT,
    ADD COLUMN IF NOT EXISTS grid_y INT,
    ADD COLUMN IF NOT EXISTS grid_w INT,
    ADD COLUMN IF NOT EXISTS grid_h INT;

-- Backfill w/h from the legacy `size` column. Leave x/y NULL for auto-flow.
UPDATE ui.dashboard_item
   SET grid_w = CASE size
                    WHEN '2x1' THEN 2
                    WHEN '2x2' THEN 2
                    WHEN '1x2' THEN 1
                    WHEN '4x1' THEN 4
                    WHEN '4x2' THEN 4
                    WHEN '4x4' THEN 4
                    ELSE 1
                END,
       grid_h = CASE size
                    WHEN '2x1' THEN 1
                    WHEN '2x2' THEN 2
                    WHEN '1x2' THEN 2
                    WHEN '4x1' THEN 1
                    WHEN '4x2' THEN 2
                    WHEN '4x4' THEN 4
                    ELSE 1
                END
 WHERE grid_w IS NULL;

-- Self-contained atomic "set all items" for a dashboard. Replaces the entire
-- item set in one transaction. The TS caller (DashboardComponent.itemSetAll)
-- already enforces the per-dashboard item-count budget, so no budget check
-- lives here. widget_config / mobile_layout use NULLIF(...,'null'::jsonb) so a
-- JSON null collapses to SQL NULL — a raw 'null'::jsonb would violate
-- dashboard_item_typed_chk (widget_config must be NULL for non-widget kinds).
CREATE OR REPLACE FUNCTION ui.fn_dashboard_item_set_all(
    p_dashboard INT,
    p_items     JSONB
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    r_count INT := 0;
    item    JSONB;
BEGIN
    DELETE FROM ui.dashboard_item WHERE dashboard = p_dashboard;

    FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO ui.dashboard_item (
            dashboard, kind, "order", size, mobile_layout,
            device_id, entity_sub_id, group_id, location_id, tag_id, action_id,
            widget_kind, widget_config,
            grid_x, grid_y, grid_w, grid_h
        ) VALUES (
            p_dashboard,
            item->>'kind',
            COALESCE((item->>'order')::INT, r_count),
            COALESCE(item->>'size', '1x1'),
            NULLIF(item->'mobileLayout', 'null'::jsonb),
            (item->>'deviceId')::INT,
            item->>'entitySubId',
            (item->>'groupId')::INT,
            (item->>'locationId')::INT,
            (item->>'tagId')::INT,
            (item->>'actionId')::INT,
            item->>'widgetKind',
            NULLIF(item->'widgetConfig', 'null'::jsonb),
            (item->>'gridX')::INT,
            (item->>'gridY')::INT,
            (item->>'gridW')::INT,
            (item->>'gridH')::INT
        );
        r_count := r_count + 1;
    END LOOP;
    RETURN r_count;
END;
$$;

-- Extend the fetch function to surface the grid coordinates per item.
DROP FUNCTION IF EXISTS ui.fn_dashboard_fetch_v2(VARCHAR, VARCHAR);
CREATE FUNCTION ui.fn_dashboard_fetch_v2(
    p_organization_id VARCHAR,
    p_user_id         VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id              INT,
    name            VARCHAR(300),
    group_id        INT,
    location_id     INT,
    tag_id          INT,
    dashboard_type  VARCHAR(20),
    organization_id VARCHAR(120),
    is_default      BOOLEAN,
    is_pinned       BOOLEAN,
    display_order   INTEGER,
    created         TIMESTAMPTZ,
    updated         TIMESTAMPTZ,
    settings        JSONB,
    items           JSONB
)
LANGUAGE sql
AS $$
    SELECT
        d.id, d.name, d.group_id, d.location_id, d.tag_id,
        d.dashboard_type, d.organization_id, d.is_default,
        EXISTS (
            SELECT 1 FROM ui.dashboard_pin p
             WHERE p.dashboard_id = d.id AND p.user_id = p_user_id
        ) AS is_pinned,
        ord.display_order,
        d.created, d.updated,
        COALESCE(
            (SELECT to_jsonb(s) - 'id' - 'dashboard_id' - 'created' - 'updated'
               FROM ui.dashboard_settings s
              WHERE s.dashboard_id = d.id LIMIT 1),
            '{}'::jsonb
        ) AS settings,
        COALESCE(
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'id',           di.id,
                    'kind',         di.kind,
                    'deviceId',     di.device_id,
                    'entitySubId',  di.entity_sub_id,
                    'groupId',      di.group_id,
                    'locationId',   di.location_id,
                    'tagId',        di.tag_id,
                    'actionId',     di.action_id,
                    'widgetKind',   di.widget_kind,
                    'widgetConfig', di.widget_config,
                    'order',        di."order",
                    'size',         COALESCE(di.size, '1x1'),
                    'mobileLayout', di.mobile_layout,
                    'gridX',        di.grid_x,
                    'gridY',        di.grid_y,
                    'gridW',        di.grid_w,
                    'gridH',        di.grid_h
                ) ORDER BY di."order", di.id
             )
             FROM ui.dashboard_item di
             WHERE di.dashboard = d.id),
            '[]'::jsonb
        ) AS items
    FROM ui.dashboard d
    LEFT JOIN ui.dashboard_order_user ord
           ON ord.dashboard_id = d.id
          AND ord.user_id = p_user_id
    WHERE d.organization_id = p_organization_id
    ORDER BY
        ord.display_order NULLS LAST,
        d.id;
$$;
--------------DOWN
ALTER TABLE ui.dashboard_item
    DROP COLUMN IF EXISTS grid_x,
    DROP COLUMN IF EXISTS grid_y,
    DROP COLUMN IF EXISTS grid_w,
    DROP COLUMN IF EXISTS grid_h;
