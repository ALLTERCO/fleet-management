--------------UP
-- One transaction owns assignment removal and the complete subtree delete.
CREATE OR REPLACE FUNCTION organization.fn_location_delete_subtree(
    p_organization_id VARCHAR,
    p_root_id         INTEGER
)
RETURNS TABLE (deleted_ids INTEGER[], removed_assignments INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_ids INTEGER[];
    v_id INTEGER;
    v_removed INTEGER := 0;
BEGIN
    WITH RECURSIVE subtree AS (
        SELECT l.id, 0 AS depth, ARRAY[l.id] AS path
          FROM organization.locations l
         WHERE l.organization_id = p_organization_id
           AND l.id = p_root_id
        UNION ALL
        SELECT child.id, subtree.depth + 1, subtree.path || child.id
          FROM organization.locations child
          JOIN subtree ON child.parent_location_id = subtree.id
         WHERE child.organization_id = p_organization_id
           AND NOT child.id = ANY(subtree.path)
    )
    SELECT COALESCE(array_agg(id ORDER BY depth DESC, id DESC), ARRAY[]::INTEGER[])
      INTO v_ids
      FROM subtree;

    IF cardinality(v_ids) = 0 THEN
        RETURN QUERY SELECT v_ids, 0;
        RETURN;
    END IF;

    DELETE FROM organization.location_assignments
     WHERE organization_id = p_organization_id
       AND location_id = ANY(v_ids);
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    FOREACH v_id IN ARRAY v_ids LOOP
        DELETE FROM organization.locations
         WHERE organization_id = p_organization_id
           AND id = v_id;
    END LOOP;

    RETURN QUERY SELECT v_ids, v_removed;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_delete_subtree(VARCHAR, INTEGER);
