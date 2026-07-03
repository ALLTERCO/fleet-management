--------------UP
-- Unified per-device membership lookup. One round-trip aggregates groups,
-- location, and tags for every kind=device subject in the org. Replaces
-- the 3-call pattern in DeviceComponent serializers.
CREATE OR REPLACE FUNCTION organization.fn_device_memberships(
    p_organization_id VARCHAR
)
RETURNS TABLE (
    subject_id  VARCHAR,
    group_ids   INTEGER[],
    location_id INTEGER,
    tag_ids     INTEGER[],
    tag_keys    VARCHAR[]
)
LANGUAGE sql
AS $$
    WITH g AS (
        SELECT subject_id, ARRAY_AGG(group_id ORDER BY group_id) AS group_ids
          FROM organization.group_members
         WHERE organization_id = p_organization_id
           AND subject_type = 'device'
         GROUP BY subject_id
    ), l AS (
        SELECT subject_id, location_id
          FROM organization.location_assignments
         WHERE organization_id = p_organization_id
           AND subject_type = 'device'
    ), t AS (
        SELECT ta.subject_id,
               ARRAY_AGG(ta.tag_id ORDER BY ta.tag_id) AS tag_ids,
               ARRAY_AGG(tags.key ORDER BY ta.tag_id) AS tag_keys
          FROM organization.tag_assignments ta
          JOIN organization.tags tags
            ON tags.organization_id = ta.organization_id
           AND tags.id = ta.tag_id
         WHERE ta.organization_id = p_organization_id
           AND ta.subject_type = 'device'
         GROUP BY ta.subject_id
    )
    SELECT s.subject_id,
           COALESCE(g.group_ids, ARRAY[]::INTEGER[]),
           l.location_id,
           COALESCE(t.tag_ids,   ARRAY[]::INTEGER[]),
           COALESCE(t.tag_keys,  ARRAY[]::VARCHAR[])
      FROM (
          SELECT subject_id FROM g
          UNION SELECT subject_id FROM l
          UNION SELECT subject_id FROM t
      ) s
      LEFT JOIN g ON g.subject_id = s.subject_id
      LEFT JOIN l ON l.subject_id = s.subject_id
      LEFT JOIN t ON t.subject_id = s.subject_id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_device_memberships(VARCHAR);
