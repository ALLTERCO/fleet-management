--------------UP
-- Depth cap guards CTE against hypothetical data-level cycles.
CREATE OR REPLACE FUNCTION organization.fn_location_path(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (id INTEGER, name VARCHAR, kind VARCHAR, depth INTEGER)
LANGUAGE sql
AS $$
    WITH RECURSIVE path AS (
        SELECT l.id, l.name, l.kind, l.parent_location_id, 0 AS depth
        FROM organization.locations l
        WHERE l.id = p_id AND l.organization_id = p_organization_id
        UNION ALL
        SELECT l.id, l.name, l.kind, l.parent_location_id, p.depth + 1
        FROM organization.locations l
        JOIN path p ON l.id = p.parent_location_id
        WHERE l.organization_id = p_organization_id AND p.depth < 64
    )
    SELECT id, name, kind, depth
    FROM path
    ORDER BY depth DESC;
$$;
--------------DOWN
CREATE OR REPLACE FUNCTION organization.fn_location_path(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (id INTEGER, name VARCHAR, kind VARCHAR, depth INTEGER)
LANGUAGE sql
AS $$
    WITH RECURSIVE path AS (
        SELECT l.id, l.name, l.kind, l.parent_location_id, 0 AS depth
        FROM organization.locations l
        WHERE l.id = p_id AND l.organization_id = p_organization_id
        UNION ALL
        SELECT l.id, l.name, l.kind, l.parent_location_id, p.depth + 1
        FROM organization.locations l
        JOIN path p ON l.id = p.parent_location_id
        WHERE l.organization_id = p_organization_id
    )
    SELECT id, name, kind, depth
    FROM path
    ORDER BY depth DESC;
$$;
