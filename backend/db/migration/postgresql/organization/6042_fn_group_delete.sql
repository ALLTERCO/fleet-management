--------------UP
-- Reject if child groups exist. Direct member rows cascade via FK.
CREATE OR REPLACE FUNCTION organization.fn_group_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (id INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM organization.groups
        WHERE parent_group_id = p_id
          AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'group % has child groups', p_id
            USING ERRCODE = '23503',
                  DETAIL  = 'GroupDeleteBlockedHasChildren';
    END IF;

    RETURN QUERY
    DELETE FROM organization.groups
    WHERE groups.id = p_id AND groups.organization_id = p_organization_id
    RETURNING groups.id;
END;
$$;
--------------DOWN
DROP FUNCTION organization.fn_group_delete;
