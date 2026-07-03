--------------UP
-- FK RESTRICT guards children + assignments.
CREATE OR REPLACE FUNCTION organization.fn_location_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (deleted BOOLEAN)
LANGUAGE sql
AS $$
    WITH d AS (
        DELETE FROM organization.locations
        WHERE id = p_id AND organization_id = p_organization_id
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM d);
$$;
--------------DOWN
DROP FUNCTION organization.fn_location_delete;
