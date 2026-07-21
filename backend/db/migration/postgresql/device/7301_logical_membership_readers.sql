--------------UP
CREATE OR REPLACE FUNCTION device.fn_device_memberships(
    p_org_id VARCHAR,
    p_shelly_id VARCHAR
)
RETURNS TABLE (
    group_ids INTEGER[],
    location_ids INTEGER[],
    tag_ids INTEGER[]
)
LANGUAGE sql
STABLE
AS $$
    WITH target AS (
        SELECT d.id
          FROM device.list d
         WHERE d.organization_id = p_org_id
           AND d.external_id = p_shelly_id
         LIMIT 1
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
        ARRAY(
            SELECT la.location_id
              FROM organization.location_assignments la
              JOIN target ON target.id = la.device_id
             WHERE la.organization_id = p_org_id
               AND la.subject_type = 'device'
             ORDER BY la.location_id
        ),
        ARRAY(
            SELECT ta.tag_id
              FROM organization.tag_assignments ta
              JOIN target ON target.id = ta.device_id
             WHERE ta.organization_id = p_org_id
               AND ta.subject_type = 'device'
             ORDER BY ta.tag_id
        );
$$;

CREATE OR REPLACE FUNCTION device.fn_device_retention_days(
    p_shelly_id VARCHAR,
    p_default_retention_standard INTEGER DEFAULT NULL,
    p_default_retention_operational INTEGER DEFAULT NULL,
    p_default_retention_critical INTEGER DEFAULT NULL,
    p_default_retention_custom INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT MAX(resolved.days)
      FROM (
        SELECT COALESCE(
            CASE
                WHEN g.metadata->'policy'->>'retentionDays' ~ '^[0-9]+$'
                THEN (g.metadata->'policy'->>'retentionDays')::INTEGER
            END,
            CASE g.group_type
                WHEN 'standard' THEN p_default_retention_standard
                WHEN 'operational' THEN p_default_retention_operational
                WHEN 'critical' THEN p_default_retention_critical
                WHEN 'custom' THEN p_default_retention_custom
            END
        ) AS days
          FROM device.list d
          JOIN organization.group_members gm
            ON gm.organization_id = d.organization_id
           AND gm.device_id = d.id
           AND gm.subject_type = 'device'
          JOIN organization.groups g
            ON g.id = gm.group_id
           AND g.organization_id = gm.organization_id
         WHERE d.external_id = p_shelly_id
      ) resolved
     WHERE resolved.days IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION device.fn_device_in_ingress_scope(
    p_org_id      VARCHAR,
    p_scope_kind  TEXT,
    p_scope_ref   TEXT,
    p_external_id VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_device_id INTEGER;
BEGIN
    SELECT dl.id INTO v_device_id
      FROM device.list dl
     WHERE dl.organization_id = p_org_id
       AND dl.external_id = p_external_id;

    IF v_device_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF p_scope_kind = 'group' THEN
        RETURN EXISTS (
            SELECT 1
              FROM organization.group_members gm
             WHERE gm.organization_id = p_org_id
               AND gm.group_id::TEXT = p_scope_ref
               AND gm.subject_type = 'device'
               AND gm.device_id = v_device_id
        );
    ELSIF p_scope_kind = 'location' THEN
        RETURN EXISTS (
            WITH RECURSIVE subtree AS (
                SELECT l.id, 1 AS depth
                  FROM organization.locations l
                 WHERE l.organization_id = p_org_id
                   AND l.id::TEXT = p_scope_ref
                UNION ALL
                SELECT child.id, subtree.depth + 1
                  FROM organization.locations child
                  JOIN subtree ON child.parent_location_id = subtree.id
                 WHERE child.organization_id = p_org_id
                   AND subtree.depth < 64
            )
            SELECT 1
              FROM subtree
              JOIN organization.location_assignments assignment
                ON assignment.organization_id = p_org_id
               AND assignment.location_id = subtree.id
             WHERE (
                       assignment.subject_type = 'device'
                   AND assignment.device_id = v_device_id
               ) OR (
                       assignment.subject_type = 'group'
                   AND EXISTS (
                       SELECT 1
                         FROM organization.group_members member
                        WHERE member.organization_id = p_org_id
                          AND member.group_id::TEXT = assignment.subject_id
                          AND member.subject_type = 'device'
                          AND member.device_id = v_device_id
                   )
               )
        );
    END IF;

    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION device.fn_resolve_scope(
    p_org_id      VARCHAR,
    p_scope_kind  TEXT,
    p_scope_id    INTEGER DEFAULT NULL
)
RETURNS TABLE (
    dev_id INTEGER,
    shelly_id VARCHAR,
    scope_kind TEXT,
    scope_id INTEGER,
    scope_name TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF p_scope_kind = 'fleet' THEN
        RETURN QUERY
        SELECT dl.id, dl.external_id, 'fleet'::TEXT,
               NULL::INTEGER, 'Fleet'::TEXT
          FROM device.list dl
         WHERE dl.organization_id = p_org_id
           AND dl.external_id IS NOT NULL;
        RETURN;
    END IF;

    IF p_scope_id IS NULL THEN
        RAISE EXCEPTION 'fn_resolve_scope: p_scope_id required for kind=%',
            p_scope_kind;
    END IF;

    IF p_scope_kind = 'group' THEN
        RETURN QUERY
        SELECT dl.id, dl.external_id, 'group'::TEXT,
               g.id, g.name::TEXT
          FROM organization.groups g
          JOIN organization.group_members member
            ON member.organization_id = g.organization_id
           AND member.group_id = g.id
           AND member.subject_type = 'device'
          JOIN device.list dl
            ON dl.organization_id = member.organization_id
           AND dl.id = member.device_id
         WHERE g.organization_id = p_org_id
           AND g.id = p_scope_id;
        RETURN;
    END IF;

    IF p_scope_kind = 'location' THEN
        RETURN QUERY
        SELECT dl.id, dl.external_id, 'location'::TEXT,
               location.id, location.name::TEXT
          FROM organization.locations location
          JOIN organization.location_assignments assignment
            ON assignment.organization_id = location.organization_id
           AND assignment.location_id = location.id
           AND assignment.subject_type = 'device'
          JOIN device.list dl
            ON dl.organization_id = assignment.organization_id
           AND dl.id = assignment.device_id
         WHERE location.organization_id = p_org_id
           AND location.id = p_scope_id
        UNION
        SELECT dl.id, dl.external_id, 'location'::TEXT,
               location.id, location.name::TEXT
          FROM organization.locations location
          JOIN organization.location_assignments assignment
            ON assignment.organization_id = location.organization_id
           AND assignment.location_id = location.id
           AND assignment.subject_type = 'group'
          JOIN organization.group_members member
            ON member.organization_id = assignment.organization_id
           AND member.group_id::TEXT = assignment.subject_id
           AND member.subject_type = 'device'
          JOIN device.list dl
            ON dl.organization_id = member.organization_id
           AND dl.id = member.device_id
         WHERE location.organization_id = p_org_id
           AND location.id = p_scope_id;
        RETURN;
    END IF;

    IF p_scope_kind = 'tag' THEN
        RETURN QUERY
        SELECT dl.id, dl.external_id, 'tag'::TEXT,
               tag.id, tag.name::TEXT
          FROM organization.tags tag
          JOIN organization.tag_assignments assignment
            ON assignment.organization_id = tag.organization_id
           AND assignment.tag_id = tag.id
           AND assignment.subject_type = 'device'
          JOIN device.list dl
            ON dl.organization_id = assignment.organization_id
           AND dl.id = assignment.device_id
         WHERE tag.organization_id = p_org_id
           AND tag.id = p_scope_id;
        RETURN;
    END IF;

    RAISE EXCEPTION 'fn_resolve_scope: unknown p_scope_kind=%', p_scope_kind;
END;
$$;

-- LINT-IGNORE: additive-only — PostgreSQL requires DROP before replacing this table-returning function.
DROP FUNCTION IF EXISTS device.fn_resolve_scope_locations(VARCHAR, INTEGER[]);
CREATE OR REPLACE FUNCTION device.fn_resolve_scope_locations(
    p_org_id       VARCHAR,
    p_location_ids INTEGER[]
)
RETURNS TABLE (scope_id INTEGER, shelly_id VARCHAR)
LANGUAGE sql
STABLE
AS $$
    SELECT location.id, dl.external_id
      FROM organization.locations location
      JOIN organization.location_assignments assignment
        ON assignment.organization_id = location.organization_id
       AND assignment.location_id = location.id
       AND assignment.subject_type = 'device'
      JOIN device.list dl
        ON dl.organization_id = assignment.organization_id
       AND dl.id = assignment.device_id
     WHERE location.organization_id = p_org_id
       AND location.id = ANY(p_location_ids)
    UNION
    SELECT location.id, dl.external_id
      FROM organization.locations location
      JOIN organization.location_assignments assignment
        ON assignment.organization_id = location.organization_id
       AND assignment.location_id = location.id
       AND assignment.subject_type = 'group'
      JOIN organization.group_members member
        ON member.organization_id = assignment.organization_id
       AND member.group_id::TEXT = assignment.subject_id
       AND member.subject_type = 'device'
      JOIN device.list dl
        ON dl.organization_id = member.organization_id
       AND dl.id = member.device_id
     WHERE location.organization_id = p_org_id
       AND location.id = ANY(p_location_ids);
$$;

--------------DOWN
-- Forward-only logical identity migration.
