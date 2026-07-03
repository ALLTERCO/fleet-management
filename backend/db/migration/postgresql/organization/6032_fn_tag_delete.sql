--------------UP
-- Assignment rows cascade via tag_id FK.
CREATE OR REPLACE FUNCTION organization.fn_tag_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (id INTEGER)
LANGUAGE sql
AS $$
    DELETE FROM organization.tags
    WHERE id = p_id AND organization_id = p_organization_id
    RETURNING id;
$$;
--------------DOWN
DROP FUNCTION organization.fn_tag_delete;
