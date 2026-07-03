--------------UP
-- Org-scoped dashboard fetch. Single query returns dashboard row plus
-- its items as a JSON array — avoids per-row N+1 item fetches.
DROP FUNCTION IF EXISTS ui.fn_dashboard_fetch();
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
                       'id', di.id,
                       'dashboard', di.dashboard,
                       'type', di.type,
                       'item', di.item,
                       'order', di."order",
                       'sub_item', di.sub_item,
                       'type_name', dit.name,
                       'size', COALESCE(di.size, '1x1')
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
CREATE FUNCTION ui.fn_dashboard_fetch()
RETURNS TABLE (
    id INT,
    name VARCHAR(300),
    group_id INT,
    dashboard_type VARCHAR(20)
)
LANGUAGE sql
AS $$
    SELECT d.id, d.name, d.group_id, d.dashboard_type FROM ui.dashboard d;
$$;
