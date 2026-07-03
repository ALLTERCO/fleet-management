--------------UP
-- Recursive subtree count for a root location.
--   p_allowed_subject_ids       = exact-match allowlist (e.g. shelly_ids for 'device')
--   p_allowed_device_prefixes   = prefix allowlist for entity-type subject_ids
CREATE OR REPLACE FUNCTION organization.fn_location_descendants_count(
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
        FROM organization.locations
        WHERE id = p_root_id AND organization_id = p_organization_id
        UNION ALL
        SELECT c.id, t.depth + 1
        FROM organization.locations c
        JOIN tree t ON c.parent_location_id = t.id
        WHERE c.organization_id = p_organization_id
          AND t.depth < 64
    )
    SELECT COUNT(*)::BIGINT
    FROM organization.location_assignments la
    WHERE la.organization_id = p_organization_id
      AND la.subject_type = p_subject_type
      AND la.location_id IN (SELECT id FROM tree)
      AND (p_allowed_subject_ids IS NULL
           OR la.subject_id = ANY(p_allowed_subject_ids))
      AND organization.fn_entity_belongs_to_device(la.subject_id, p_allowed_device_prefixes);
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_descendants_count(INTEGER, VARCHAR, VARCHAR, VARCHAR[], VARCHAR[]);
DROP FUNCTION IF EXISTS organization.fn_location_descendants_count(INTEGER, VARCHAR, VARCHAR, VARCHAR[]);
DROP FUNCTION IF EXISTS organization.fn_location_descendants_count(INTEGER, VARCHAR, VARCHAR);
