--------------UP
-- Is a connecting device (external_id) inside a credential identity's scope?
--   group    → a direct device member of that group (flat, no descent)
--   location → assigned to the location or any descendant location, either
--              directly or via a group assigned there (subtree)
-- The device scope (exact expected_external_id) is checked in app, not here.
CREATE OR REPLACE FUNCTION device.fn_device_in_ingress_scope(
    p_org_id      VARCHAR,
    p_scope_kind  TEXT,
    p_scope_ref   TEXT,
    p_external_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_scope_kind = 'group' THEN
        RETURN EXISTS (
            SELECT 1
              FROM organization.group_members gm
             WHERE gm.organization_id = p_org_id
               AND gm.group_id::TEXT = p_scope_ref
               AND gm.subject_type = 'device'
               AND gm.subject_id = p_external_id
        );
    ELSIF p_scope_kind = 'location' THEN
        RETURN EXISTS (
            WITH RECURSIVE subtree AS (
                SELECT l.id, 1 AS depth
                  FROM organization.locations l
                 WHERE l.organization_id = p_org_id
                   AND l.id::TEXT = p_scope_ref
                UNION ALL
                -- Depth cap guards the CTE against a cyclic parent_location_id,
                -- matching organization.fn_location_is_ancestor.
                SELECT child.id, s.depth + 1
                  FROM organization.locations child
                  JOIN subtree s ON child.parent_location_id = s.id
                 WHERE child.organization_id = p_org_id
                   AND s.depth < 64
            )
            SELECT 1
              FROM subtree s
              JOIN organization.location_assignments la
                ON la.organization_id = p_org_id
               AND la.location_id = s.id
             WHERE (la.subject_type = 'device' AND la.subject_id = p_external_id)
                OR (
                       la.subject_type = 'group'
                   AND EXISTS (
                           SELECT 1
                             FROM organization.group_members gm
                            WHERE gm.organization_id = p_org_id
                              AND gm.group_id::TEXT = la.subject_id
                              AND gm.subject_type = 'device'
                              AND gm.subject_id = p_external_id
                       )
                   )
        );
    END IF;
    RETURN FALSE;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device.fn_device_in_ingress_scope(VARCHAR, TEXT, TEXT, VARCHAR);
