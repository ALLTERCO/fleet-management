--------------UP
-- Breadcrumb from root to the given group. Depth-capped to 64.
CREATE OR REPLACE FUNCTION organization.fn_group_path(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id   INTEGER,
    name VARCHAR
)
LANGUAGE sql
AS $$
    WITH RECURSIVE chain AS (
        SELECT g.id, g.name, g.parent_group_id, 1 AS depth
        FROM organization.groups g
        WHERE g.id = p_id
          AND g.organization_id = p_organization_id
        UNION ALL
        SELECT g.id, g.name, g.parent_group_id, c.depth + 1
        FROM organization.groups g
        JOIN chain c ON g.id = c.parent_group_id
        WHERE g.organization_id = p_organization_id
          AND c.depth < 64
    )
    SELECT chain.id, chain.name
    FROM chain
    ORDER BY chain.depth DESC;
$$;
--------------DOWN
DROP FUNCTION organization.fn_group_path;
