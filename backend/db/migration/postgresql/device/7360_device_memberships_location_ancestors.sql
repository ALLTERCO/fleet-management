--------------UP
-- Location-scoped rules apply to the full subtree. A device's effective
-- locations come from either its own assignment or an assignment on one of
-- its groups. Return every effective location and each ancestor.
DROP FUNCTION IF EXISTS device.fn_device_memberships(VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION device.fn_device_memberships(
    p_org_id VARCHAR,
    p_shelly_id VARCHAR
)
RETURNS TABLE (group_ids INTEGER[], location_ids INTEGER[], tag_ids INTEGER[])
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE target AS (
        SELECT d.id
          FROM device.list d
         WHERE d.organization_id = p_org_id
           AND d.external_id = p_shelly_id
           AND d.deleted_at IS NULL
         LIMIT 1
    ), assigned_locations AS (
        SELECT la.location_id
          FROM organization.location_assignments la
          JOIN target ON target.id = la.device_id
         WHERE la.organization_id = p_org_id
           AND la.subject_type = 'device'
        UNION
        SELECT la.location_id
          FROM organization.group_members gm
          JOIN target ON target.id = gm.device_id
          JOIN organization.location_assignments la
            ON la.organization_id = gm.organization_id
           AND la.subject_type = 'group'
           AND la.subject_id = gm.group_id::TEXT
         WHERE gm.organization_id = p_org_id
           AND gm.subject_type = 'device'
    ), location_tree AS (
        SELECT l.id, l.parent_location_id, 1 AS depth
          FROM assigned_locations assigned
          JOIN organization.locations l
            ON l.id = assigned.location_id
           AND l.organization_id = p_org_id
        UNION ALL
        SELECT parent.id, parent.parent_location_id, tree.depth + 1
          FROM location_tree tree
          JOIN organization.locations parent
            ON parent.id = tree.parent_location_id
           AND parent.organization_id = p_org_id
         WHERE tree.depth < 64
    )
    SELECT
        ARRAY(
            SELECT gm.group_id
              FROM organization.group_members gm
              JOIN target ON target.id = gm.device_id
             WHERE gm.organization_id = p_org_id
               AND gm.subject_type = 'device'
             ORDER BY gm.group_id
        ),
        ARRAY(SELECT DISTINCT id FROM location_tree ORDER BY id),
        ARRAY(
            SELECT ta.tag_id
              FROM organization.tag_assignments ta
              JOIN target ON target.id = ta.device_id
             WHERE ta.organization_id = p_org_id
               AND ta.subject_type = 'device'
             ORDER BY ta.tag_id
        );
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device.fn_device_memberships(VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION device.fn_device_memberships(
    p_org_id VARCHAR,
    p_shelly_id VARCHAR
)
RETURNS TABLE (group_ids INTEGER[], location_ids INTEGER[], tag_ids INTEGER[])
LANGUAGE sql
STABLE
AS $$
    WITH target AS (
        SELECT d.id FROM device.list d
         WHERE d.organization_id = p_org_id AND d.external_id = p_shelly_id
         LIMIT 1
    )
    SELECT
        ARRAY(SELECT gm.group_id FROM organization.group_members gm JOIN target ON target.id = gm.device_id WHERE gm.organization_id = p_org_id AND gm.subject_type = 'device' ORDER BY gm.group_id),
        ARRAY(SELECT la.location_id FROM organization.location_assignments la JOIN target ON target.id = la.device_id WHERE la.organization_id = p_org_id AND la.subject_type = 'device' ORDER BY la.location_id),
        ARRAY(SELECT ta.tag_id FROM organization.tag_assignments ta JOIN target ON target.id = ta.device_id WHERE ta.organization_id = p_org_id AND ta.subject_type = 'device' ORDER BY ta.tag_id);
$$;
