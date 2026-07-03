--------------UP
-- Reverse-lookup: given a device shellyID, return the group / location /
-- tag id arrays it belongs to. One DB read per alert event — the matcher
-- (modules/alert/scope.ts) does pure Set ops on the result.
CREATE OR REPLACE FUNCTION device.fn_device_memberships(
    p_org_id     VARCHAR,
    p_shelly_id  VARCHAR
)
RETURNS TABLE (
    group_ids     INTEGER[],
    location_ids  INTEGER[],
    tag_ids       INTEGER[]
)
LANGUAGE sql
AS $$
    SELECT
        COALESCE(
            ARRAY(
                SELECT gm.group_id
                FROM organization.group_members gm
                WHERE gm.organization_id = p_org_id
                  AND gm.subject_type = 'device'
                  AND gm.subject_id = p_shelly_id
            ),
            '{}'::INTEGER[]
        ) AS group_ids,
        COALESCE(
            ARRAY(
                SELECT la.location_id
                FROM organization.location_assignments la
                WHERE la.organization_id = p_org_id
                  AND la.subject_type = 'device'
                  AND la.subject_id = p_shelly_id
            ),
            '{}'::INTEGER[]
        ) AS location_ids,
        COALESCE(
            ARRAY(
                SELECT ta.tag_id
                FROM organization.tag_assignments ta
                WHERE ta.organization_id = p_org_id
                  AND ta.subject_type = 'device'
                  AND ta.subject_id = p_shelly_id
            ),
            '{}'::INTEGER[]
        ) AS tag_ids;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_device_memberships(VARCHAR, VARCHAR);
