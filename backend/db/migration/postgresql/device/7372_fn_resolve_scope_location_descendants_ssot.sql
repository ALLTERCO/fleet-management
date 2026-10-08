--------------UP
-- Keep group/location graph traversal in fn_resolve_scope, but delegate the
-- location subtree itself to the same organization function used by
-- Location.Descendants. This removes the second parent_location_id recursion.
CREATE OR REPLACE FUNCTION device.fn_resolve_scope(
    p_org_id VARCHAR,
    p_scope_kind TEXT,
    p_scope_id INTEGER DEFAULT NULL
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
           AND dl.external_id IS NOT NULL
           AND dl.deleted_at IS NULL;
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
                   parent.id::TEXT,
                   'location'::TEXT,
                   descendant.id::TEXT
              FROM organization.locations parent
              CROSS JOIN LATERAL organization.fn_location_descendant_ids(
                  p_org_id, parent.id, FALSE
              ) descendant
             WHERE parent.organization_id = p_org_id
        ), closure(node_kind, node_id, seen) AS (
            SELECT p_scope_kind,
                   p_scope_id::TEXT,
                   ARRAY[p_scope_kind || ':' || p_scope_id::TEXT]
            UNION ALL
            SELECT edge.to_kind,
                   edge.to_id,
                   closure.seen || (edge.to_kind || ':' || edge.to_id)
              FROM closure
              JOIN edges edge
                ON edge.from_kind = closure.node_kind
               AND edge.from_id = closure.node_id
             WHERE NOT (edge.to_kind || ':' || edge.to_id) = ANY(closure.seen)
               AND array_length(closure.seen, 1) < 64
        ), root AS (
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
        ), reached AS (
            SELECT member.device_id
              FROM closure
              JOIN organization.group_members member
                ON member.organization_id = p_org_id
               AND member.group_id::TEXT = closure.node_id
               AND member.subject_type = 'device'
             WHERE closure.node_kind = 'group'
            UNION
            SELECT assignment.device_id
              FROM closure
              JOIN organization.location_assignments assignment
                ON assignment.organization_id = p_org_id
               AND assignment.location_id::TEXT = closure.node_id
               AND assignment.subject_type = 'device'
             WHERE closure.node_kind = 'location'
        )
        SELECT dl.id, dl.external_id, p_scope_kind, p_scope_id, root.name
          FROM reached
          CROSS JOIN root
          JOIN device.list dl
            ON dl.organization_id = p_org_id
           AND dl.id = reached.device_id
           AND dl.deleted_at IS NULL;
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
           AND dl.deleted_at IS NULL
         WHERE tag.organization_id = p_org_id
           AND tag.id = p_scope_id;
        RETURN;
    END IF;

    RAISE EXCEPTION 'fn_resolve_scope: unknown p_scope_kind=%', p_scope_kind;
END;
$$;

--------------DOWN
-- Restore the direct-edge traversal from 7347.
CREATE OR REPLACE FUNCTION device.fn_resolve_scope(
    p_org_id VARCHAR,
    p_scope_kind TEXT,
    p_scope_id INTEGER DEFAULT NULL
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
           AND dl.external_id IS NOT NULL
           AND dl.deleted_at IS NULL;
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
        ), closure(node_kind, node_id, seen) AS (
            SELECT p_scope_kind,
                   p_scope_id::TEXT,
                   ARRAY[p_scope_kind || ':' || p_scope_id::TEXT]
            UNION ALL
            SELECT edge.to_kind,
                   edge.to_id,
                   closure.seen || (edge.to_kind || ':' || edge.to_id)
              FROM closure
              JOIN edges edge
                ON edge.from_kind = closure.node_kind
               AND edge.from_id = closure.node_id
             WHERE NOT (edge.to_kind || ':' || edge.to_id) = ANY(closure.seen)
               AND array_length(closure.seen, 1) < 64
        ), root AS (
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
        ), reached AS (
            SELECT member.device_id
              FROM closure
              JOIN organization.group_members member
                ON member.organization_id = p_org_id
               AND member.group_id::TEXT = closure.node_id
               AND member.subject_type = 'device'
             WHERE closure.node_kind = 'group'
            UNION
            SELECT assignment.device_id
              FROM closure
              JOIN organization.location_assignments assignment
                ON assignment.organization_id = p_org_id
               AND assignment.location_id::TEXT = closure.node_id
               AND assignment.subject_type = 'device'
             WHERE closure.node_kind = 'location'
        )
        SELECT dl.id, dl.external_id, p_scope_kind, p_scope_id, root.name
          FROM reached
          CROSS JOIN root
          JOIN device.list dl
            ON dl.organization_id = p_org_id
           AND dl.id = reached.device_id
           AND dl.deleted_at IS NULL;
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
           AND dl.deleted_at IS NULL
         WHERE tag.organization_id = p_org_id
           AND tag.id = p_scope_id;
        RETURN;
    END IF;

    RAISE EXCEPTION 'fn_resolve_scope: unknown p_scope_kind=%', p_scope_kind;
END;
$$;
