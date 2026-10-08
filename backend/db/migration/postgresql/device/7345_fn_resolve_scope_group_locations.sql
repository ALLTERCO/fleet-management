--------------UP
-- A group can hold locations (organization.group_members.subject_type =
-- 'location', counted as c_locations by fn_group_get) and a location can hold
-- groups (organization.location_assignments.subject_type = 'group'). Only the
-- second edge was ever resolved, so devices reached through the first one
-- silently dropped out of every group-scoped alert, report and dashboard.
--
-- Both edges now expand through one closure, so the two directions cannot
-- disagree. The closure carries the path it took and refuses to revisit a
-- node, which is what makes group -> location -> group cycles terminate;
-- nothing in either table prevents a user from creating one.
--
-- Deliberately unchanged: a location does NOT pull in its child locations
-- here. device.fn_device_in_ingress_scope does walk the location subtree, so
-- the two still disagree on that point — changing it moves every existing
-- location-scoped threshold, which is a product decision, not a bug fix.
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

    IF p_scope_kind IN ('group', 'location') THEN
        RETURN QUERY
        WITH RECURSIVE edges(from_kind, from_id, to_kind, to_id) AS (
            SELECT 'location'::TEXT,
                   assignment.location_id::TEXT,
                   'group'::TEXT,
                   assignment.subject_id::TEXT
              FROM organization.location_assignments assignment
             WHERE assignment.organization_id = p_org_id
               AND assignment.subject_type = 'group'
            UNION ALL
            SELECT 'group'::TEXT,
                   member.group_id::TEXT,
                   'location'::TEXT,
                   member.subject_id::TEXT
              FROM organization.group_members member
             WHERE member.organization_id = p_org_id
               AND member.subject_type = 'location'
        ),
        -- `seen` is the path taken so far. Refusing to revisit a node is what
        -- terminates a group -> location -> group cycle; the recursive term
        -- names `closure` exactly once, as PostgreSQL requires.
        closure(node_kind, node_id, seen) AS (
            SELECT p_scope_kind,
                   p_scope_id::TEXT,
                   ARRAY[p_scope_kind || ':' || p_scope_id::TEXT]
            UNION ALL
            SELECT e.to_kind,
                   e.to_id,
                   c.seen || (e.to_kind || ':' || e.to_id)
              FROM closure c
              JOIN edges e
                ON e.from_kind = c.node_kind
               AND e.from_id = c.node_id
             WHERE NOT (e.to_kind || ':' || e.to_id) = ANY(c.seen)
               AND array_length(c.seen, 1) < 64
        ),
        root AS (
            SELECT CASE
                       WHEN p_scope_kind = 'group' THEN (
                           SELECT g.name::TEXT
                             FROM organization.groups g
                            WHERE g.organization_id = p_org_id
                              AND g.id = p_scope_id
                       )
                       ELSE (
                           SELECT l.name::TEXT
                             FROM organization.locations l
                            WHERE l.organization_id = p_org_id
                              AND l.id = p_scope_id
                       )
                   END AS name
        ),
        reached AS (
            SELECT member.device_id
              FROM closure c
              JOIN organization.group_members member
                ON member.organization_id = p_org_id
               AND member.group_id::TEXT = c.node_id
               AND member.subject_type = 'device'
             WHERE c.node_kind = 'group'
            UNION
            SELECT assignment.device_id
              FROM closure c
              JOIN organization.location_assignments assignment
                ON assignment.organization_id = p_org_id
               AND assignment.location_id::TEXT = c.node_id
               AND assignment.subject_type = 'device'
             WHERE c.node_kind = 'location'
        )
        SELECT dl.id, dl.external_id, p_scope_kind, p_scope_id, root.name
          FROM reached
          CROSS JOIN root
          JOIN device.list dl
            ON dl.organization_id = p_org_id
           AND dl.id = reached.device_id;
        RETURN;
    END IF;

    IF p_scope_kind = 'tag' THEN
        RETURN QUERY
        SELECT dl.id, dl.external_id, 'tag'::TEXT,
               t.id, t.name::TEXT
          FROM organization.tags t
          JOIN organization.tag_assignments assignment
            ON assignment.organization_id = t.organization_id
           AND assignment.tag_id = t.id
           AND assignment.subject_type = 'device'
          JOIN device.list dl
            ON dl.organization_id = assignment.organization_id
           AND dl.id = assignment.device_id
         WHERE t.organization_id = p_org_id
           AND t.id = p_scope_id;
        RETURN;
    END IF;

    RAISE EXCEPTION 'fn_resolve_scope: unknown p_scope_kind=%', p_scope_kind;
END;
$$;

--------------DOWN
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
               t.id, t.name::TEXT
          FROM organization.tags t
          JOIN organization.tag_assignments assignment
            ON assignment.organization_id = t.organization_id
           AND assignment.tag_id = t.id
           AND assignment.subject_type = 'device'
          JOIN device.list dl
            ON dl.organization_id = assignment.organization_id
           AND dl.id = assignment.device_id
         WHERE t.organization_id = p_org_id
           AND t.id = p_scope_id;
        RETURN;
    END IF;

    RAISE EXCEPTION 'fn_resolve_scope: unknown p_scope_kind=%', p_scope_kind;
END;
$$;
