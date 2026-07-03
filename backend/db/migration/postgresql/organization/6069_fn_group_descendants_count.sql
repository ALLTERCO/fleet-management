--------------UP
-- Recursive subtree count for a root group.
--   p_allowed_subject_ids       = exact-match allowlist (e.g. shelly_ids for 'device')
--   p_allowed_device_prefixes   = prefix allowlist for entity-type subject_ids
CREATE OR REPLACE FUNCTION organization.fn_group_descendants_count(
    p_root_id                   INTEGER,
    p_organization_id           VARCHAR,
    p_subject_type              VARCHAR,
    p_allowed_subject_ids       VARCHAR[] DEFAULT NULL,
    p_allowed_device_prefixes   VARCHAR[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT id, 1 AS depth
        FROM organization.groups
        WHERE id = p_root_id AND organization_id = p_organization_id
        UNION ALL
        SELECT c.id, t.depth + 1
        FROM organization.groups c
        JOIN tree t ON c.parent_group_id = t.id
        WHERE c.organization_id = p_organization_id
          AND t.depth < 64
    )
    SELECT COUNT(*)::BIGINT
    FROM organization.group_members gm
    WHERE gm.organization_id = p_organization_id
      AND gm.subject_type = p_subject_type
      AND gm.group_id IN (SELECT id FROM tree)
      AND (p_allowed_subject_ids IS NULL
           OR gm.subject_id = ANY(p_allowed_subject_ids))
      AND organization.fn_entity_belongs_to_device(gm.subject_id, p_allowed_device_prefixes);
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_group_descendants_count(INTEGER, VARCHAR, VARCHAR, VARCHAR[], VARCHAR[]);
DROP FUNCTION IF EXISTS organization.fn_group_descendants_count(INTEGER, VARCHAR, VARCHAR, VARCHAR[]);
DROP FUNCTION IF EXISTS organization.fn_group_descendants_count(INTEGER, VARCHAR, VARCHAR);
