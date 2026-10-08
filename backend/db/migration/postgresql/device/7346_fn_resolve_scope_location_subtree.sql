--------------UP
-- A location scope now covers its descendant locations.
--
-- Locations nest site > building > floor > room. Pinning a device to a room
-- removed it from the building's scope, so an alert or report on the building
-- evaluated a different device set than the one the UI showed for it:
-- useLocationRollups counts devices across the subtree and the devices tab
-- says "or any of its descendants", while this resolver counted only the rows
-- pinned to the building itself. device.fn_device_in_ingress_scope already
-- walked the subtree, so the two disagreed.
--
-- Groups are deliberately still direct-only. fn_group_get reports c_devices
-- and c_descendant_devices as separate numbers, so the group UI never claims a
-- parent group contains its children's devices.
--
-- fn_resolve_scope_locations becomes a wrapper over this function instead of a
-- second copy of the same traversal.
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
            UNION ALL
            SELECT 'location'::TEXT,
                   child.parent_location_id::TEXT,
                   'location'::TEXT,
                   child.id::TEXT
              FROM organization.locations child
             WHERE child.organization_id = p_org_id
               AND child.parent_location_id IS NOT NULL
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

-- One traversal, not two. The batch entry point exists for callers that need
-- many locations at once; it must not answer differently from the singular one.
CREATE OR REPLACE FUNCTION device.fn_resolve_scope_locations(
    p_org_id        VARCHAR,
    p_location_ids  INTEGER[]
)
RETURNS TABLE (
    scope_id    INTEGER,
    shelly_id   VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT input.location_id, resolved.shelly_id
      FROM unnest(p_location_ids) AS input(location_id)
      CROSS JOIN LATERAL device.fn_resolve_scope(
          p_org_id, 'location', input.location_id
      ) resolved;
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

CREATE OR REPLACE FUNCTION device.fn_resolve_scope_locations(
    p_org_id        VARCHAR,
    p_location_ids  INTEGER[]
)
RETURNS TABLE (
    scope_id    INTEGER,
    shelly_id   VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        loc.id          AS scope_id,
        dl.external_id  AS shelly_id
    FROM organization.locations loc
    JOIN organization.location_assignments la
      ON la.organization_id = loc.organization_id
     AND la.location_id = loc.id
     AND la.subject_type = 'device'
    JOIN device.list dl
      ON dl.organization_id = la.organization_id
     AND dl.id = la.device_id
    WHERE loc.organization_id = p_org_id
      AND loc.id = ANY(p_location_ids)
    UNION
    SELECT
        loc.id          AS scope_id,
        dl.external_id  AS shelly_id
    FROM organization.locations loc
    JOIN organization.location_assignments la
      ON la.organization_id = loc.organization_id
     AND la.location_id = loc.id
     AND la.subject_type = 'group'
    JOIN organization.group_members gm
      ON gm.organization_id = la.organization_id
     AND gm.group_id::TEXT = la.subject_id
     AND gm.subject_type = 'device'
    JOIN device.list dl
      ON dl.organization_id = gm.organization_id
     AND dl.id = gm.device_id
    WHERE loc.organization_id = p_org_id
      AND loc.id = ANY(p_location_ids);
$$;
