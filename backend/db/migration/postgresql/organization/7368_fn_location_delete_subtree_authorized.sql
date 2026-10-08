--------------UP
-- Delete exactly the location IDs the application authorized. The locks keep
-- hierarchy and assignment writes out between the snapshot comparison and the
-- final delete, while the whole mutation remains one PostgreSQL transaction.
CREATE OR REPLACE FUNCTION organization.fn_location_delete_subtree_checked(
    p_organization_id VARCHAR,
    p_root_id         INTEGER,
    p_expected_ids    INTEGER[]
)
RETURNS TABLE (
    deleted_ids INTEGER[],
    removed_assignments INTEGER,
    subtree_changed BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_ids INTEGER[];
    v_delete_order INTEGER[];
    v_expected_ids INTEGER[];
    v_id INTEGER;
    v_removed INTEGER := 0;
BEGIN
    LOCK TABLE organization.locations IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE organization.location_assignments IN SHARE ROW EXCLUSIVE MODE;

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
    SELECT
        COALESCE(array_agg(id ORDER BY id), ARRAY[]::INTEGER[]),
        COALESCE(array_agg(id ORDER BY depth DESC, id DESC), ARRAY[]::INTEGER[])
      INTO v_current_ids, v_delete_order
      FROM subtree;

    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::INTEGER[])
      INTO v_expected_ids
      FROM (
          SELECT DISTINCT unnest(COALESCE(p_expected_ids, ARRAY[]::INTEGER[])) AS id
      ) expected;

    IF v_current_ids IS DISTINCT FROM v_expected_ids THEN
        RETURN QUERY SELECT ARRAY[]::INTEGER[], 0, TRUE;
        RETURN;
    END IF;

    IF cardinality(v_delete_order) = 0 THEN
        RETURN QUERY SELECT v_delete_order, 0, FALSE;
        RETURN;
    END IF;

    DELETE FROM organization.location_assignments
     WHERE organization_id = p_organization_id
       AND location_id = ANY(v_delete_order);
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    FOREACH v_id IN ARRAY v_delete_order LOOP
        DELETE FROM organization.locations
         WHERE organization_id = p_organization_id
           AND id = v_id;
    END LOOP;

    RETURN QUERY SELECT v_delete_order, v_removed, FALSE;
END;
$$;

-- Rolling safety: an older application process only authorized the root and
-- therefore must not retain a callable path that can bypass child denials.
CREATE OR REPLACE FUNCTION organization.fn_location_delete_subtree(
    p_organization_id VARCHAR,
    p_root_id         INTEGER
)
RETURNS TABLE (deleted_ids INTEGER[], removed_assignments INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Location subtree deletion requires an authorized snapshot'
        USING ERRCODE = '55000', DETAIL = 'LocationSubtreeChanged';
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_delete_subtree_checked(VARCHAR, INTEGER, INTEGER[]);

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
