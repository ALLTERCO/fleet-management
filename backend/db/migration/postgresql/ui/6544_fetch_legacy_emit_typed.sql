--------------UP
-- Phase 2: legacy fn_dashboard_fetch emits typed fields too so FE reads
-- the same shape regardless of which RPC pulled the dashboard.
DROP FUNCTION IF EXISTS ui.fn_dashboard_fetch(VARCHAR);
CREATE OR REPLACE FUNCTION ui.fn_dashboard_fetch(
    p_organization_id VARCHAR
)
RETURNS TABLE (
    id INT,
    name VARCHAR(300),
    group_id INT,
    dashboard_type VARCHAR(20),
    organization_id VARCHAR(120),
    location_id INT,
    tag_id INT,
    created TIMESTAMPTZ,
    updated TIMESTAMPTZ,
    items JSONB
)
LANGUAGE sql
AS $$
    SELECT d.id, d.name, d.group_id, d.dashboard_type,
           d.organization_id, d.location_id, d.tag_id,
           d.created, d.updated,
           COALESCE(
               (SELECT jsonb_agg(
                   jsonb_build_object(
                       'id',           di.id,
                       'dashboard',    di.dashboard,
                       'kind',         di.kind,
                       'type',         di.type,
                       'item',         di.item,
                       'order',        di."order",
                       'sub_item',     di.sub_item,
                       'type_name',    dit.name,
                       'size',         COALESCE(di.size, '1x1'),
                       'device_id',    di.device_id,
                       'entity_sub_id', di.entity_sub_id,
                       'group_id',     di.group_id,
                       'location_id',  di.location_id,
                       'tag_id',       di.tag_id,
                       'action_id',    di.action_id,
                       'widget_kind',  di.widget_kind,
                       'widget_config', di.widget_config
                   )
                   ORDER BY di."order", di.id
               )
               FROM ui.dashboard_item di
               LEFT JOIN ui.dashboard_item_type dit ON dit.id = di.type
               WHERE di.dashboard = d.id),
               '[]'::jsonb
           ) AS items
    FROM ui.dashboard d
    WHERE d.organization_id = p_organization_id
    ORDER BY d.id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_fetch(VARCHAR);
