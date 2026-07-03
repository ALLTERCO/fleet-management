--------------UP
-- List an org's topology edges. Org-scoped: a caller sees only their own
-- connections. Ordered by meter then nodes for a stable response.

CREATE OR REPLACE FUNCTION fm.fn_list_meter_connections(
    p_org VARCHAR(120)
)
RETURNS TABLE (
    id                 BIGINT,
    meter_id           BIGINT,
    from_node          VARCHAR(48),
    to_node            VARCHAR(48),
    positive_direction VARCHAR(16)
)
AS $$
    SELECT
        c.id,
        c.meter_id,
        c.from_node,
        c.to_node,
        c.positive_direction
    FROM fm.meter_connection c
    WHERE c.organization_id = p_org
    ORDER BY c.meter_id, c.from_node, c.to_node, c.id;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS fm.fn_list_meter_connections(VARCHAR(120));
