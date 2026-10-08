--------------UP
-- One canonical subtree expansion used by RPCs and scope resolvers.
CREATE OR REPLACE FUNCTION organization.fn_location_descendant_ids(
    p_organization_id VARCHAR,
    p_location_id INTEGER,
    p_include_self BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (id INTEGER)
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE subtree AS (
        SELECT l.id, 0 AS depth
          FROM organization.locations l
         WHERE l.organization_id = p_organization_id
           AND l.id = p_location_id
        UNION ALL
        SELECT child.id, subtree.depth + 1
          FROM organization.locations child
          JOIN subtree ON child.parent_location_id = subtree.id
         WHERE child.organization_id = p_organization_id
           AND subtree.depth < 64
    )
    SELECT subtree.id
      FROM subtree
     WHERE p_include_self OR subtree.depth > 0
     ORDER BY subtree.id;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_descendant_ids(VARCHAR, INTEGER, BOOLEAN);
