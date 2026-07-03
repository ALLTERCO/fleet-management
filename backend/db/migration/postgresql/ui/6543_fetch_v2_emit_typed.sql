--------------UP
-- Phase 2: fetch_v2 emits typed fields alongside legacy refId/subItem.
-- Old clients keep reading refId/subItem; new clients read typed.
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
                    'refId',        di.item,
                    'subItem',      di.sub_item,
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
                    'mobileLayout', di.mobile_layout
                ) ORDER BY di."order", di.id
             )
             FROM ui.dashboard_item di
             WHERE di.dashboard = d.id),
            '[]'::jsonb
        ) AS items
    FROM ui.dashboard d
    WHERE d.organization_id = p_organization_id
    ORDER BY d.id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_fetch_v2(VARCHAR, VARCHAR);
