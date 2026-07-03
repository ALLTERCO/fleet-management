--------------UP
-- Lightweight reverse lookup used by EventDistributor to tag device events.
CREATE OR REPLACE FUNCTION organization.fn_group_find_by_member(
    p_organization_id VARCHAR,
    p_subject_type    VARCHAR,
    p_subject_id      VARCHAR
)
RETURNS TABLE (
    id   INTEGER,
    name VARCHAR
)
LANGUAGE sql
AS $$
    SELECT g.id, g.name
    FROM organization.groups g
    JOIN organization.group_members gm ON gm.group_id = g.id
    WHERE gm.organization_id = p_organization_id
      AND gm.subject_type = p_subject_type
      AND gm.subject_id = p_subject_id
    ORDER BY g.name ASC;
$$;
--------------DOWN
DROP FUNCTION organization.fn_group_find_by_member;
