--------------UP
-- Flat (group_id, shelly_id) list used by CommandSender to build a
-- shellyID→groupIds reverse index for group-scoped device access checks.
-- p_group_ids NULL = all groups in org.
CREATE OR REPLACE FUNCTION organization.fn_group_device_memberships(
    p_organization_id VARCHAR,
    p_group_ids       INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    group_id   INTEGER,
    subject_id VARCHAR
)
LANGUAGE sql
AS $$
    SELECT gm.group_id, gm.subject_id
    FROM organization.group_members gm
    WHERE gm.organization_id = p_organization_id
      AND gm.subject_type = 'device'
      AND (p_group_ids IS NULL OR gm.group_id = ANY(p_group_ids));
$$;
--------------DOWN
DROP FUNCTION organization.fn_group_device_memberships;
