--------------UP
-- True if p_candidate_id is p_location_id or any ancestor of it.
CREATE OR REPLACE FUNCTION organization.fn_location_is_ancestor(
    p_organization_id VARCHAR,
    p_location_id     INTEGER,
    p_candidate_id    INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    WITH RECURSIVE ancestors AS (
        SELECT id, parent_location_id
        FROM organization.locations
        WHERE id = p_location_id AND organization_id = p_organization_id
        UNION ALL
        SELECT l.id, l.parent_location_id
        FROM organization.locations l
        JOIN ancestors a ON l.id = a.parent_location_id
        WHERE l.organization_id = p_organization_id
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = p_candidate_id);
$$;
--------------DOWN
DROP FUNCTION organization.fn_location_is_ancestor;
