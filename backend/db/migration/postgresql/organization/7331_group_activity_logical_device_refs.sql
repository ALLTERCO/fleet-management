--------------UP
CREATE OR REPLACE FUNCTION organization.fn_group_list_activity(
    p_organization_id VARCHAR,
    p_group_id INTEGER,
    p_from TIMESTAMPTZ DEFAULT NULL,
    p_to TIMESTAMPTZ DEFAULT NULL,
    p_event_types TEXT[] DEFAULT NULL,
    p_include_descendants BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    audit_id INTEGER,
    ts TIMESTAMPTZ,
    event_type VARCHAR,
    username VARCHAR,
    shelly_id VARCHAR,
    shelly_ids TEXT[],
    method VARCHAR,
    params JSONB,
    success BOOLEAN,
    error_message TEXT,
    total_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT g.id, 1 AS depth
          FROM organization.groups g
         WHERE g.organization_id = p_organization_id
           AND g.id = p_group_id
        UNION ALL
        SELECT child.id, tree.depth + 1
          FROM organization.groups child
          JOIN tree ON child.parent_group_id = tree.id
         WHERE child.organization_id = p_organization_id
           AND tree.depth < 64
           AND p_include_descendants
    ), scoped_refs AS (
        SELECT array_agg(DISTINCT gm.device_id) AS device_ids,
               array_agg(DISTINCT dl.external_id)::TEXT[] AS external_ids
          FROM organization.group_members gm
          JOIN device.list dl
            ON dl.organization_id = gm.organization_id
           AND dl.id = gm.device_id
         WHERE gm.organization_id = p_organization_id
           AND gm.subject_type = 'device'
           AND gm.group_id IN (SELECT id FROM tree)
    ), matched AS (
        SELECT audit.*
          FROM logging.audit_log audit
          CROSS JOIN scoped_refs scoped
         WHERE audit.organization_id = p_organization_id
           AND (p_from IS NULL OR audit.ts >= p_from)
           AND (p_to IS NULL OR audit.ts <= p_to)
           AND (p_event_types IS NULL OR audit.event_type = ANY(p_event_types))
           AND cardinality(scoped.device_ids) > 0
           AND (
               audit.device_id = ANY(scoped.device_ids)
               OR audit.device_ids && scoped.device_ids
               OR (
                   audit.device_id IS NULL
                   AND COALESCE(cardinality(audit.device_ids), 0) = 0
                   AND (
                       audit.shelly_id = ANY(scoped.external_ids)
                       OR audit.shelly_ids && scoped.external_ids
                   )
               )
           )
    ), counted AS (
        SELECT count(*)::BIGINT AS total_count FROM matched
    )
    SELECT matched.id,
           matched.ts,
           matched.event_type,
           matched.username,
           matched.shelly_id,
           matched.shelly_ids,
           matched.method,
           matched.params,
           matched.success,
           matched.error_message,
           counted.total_count
      FROM matched
      CROSS JOIN counted
     ORDER BY matched.ts DESC, matched.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION organization.fn_group_list_activity(
    p_organization_id VARCHAR,
    p_group_id INTEGER,
    p_from TIMESTAMPTZ DEFAULT NULL,
    p_to TIMESTAMPTZ DEFAULT NULL,
    p_event_types TEXT[] DEFAULT NULL,
    p_include_descendants BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    audit_id INTEGER,
    ts TIMESTAMPTZ,
    event_type VARCHAR,
    username VARCHAR,
    shelly_id VARCHAR,
    shelly_ids TEXT[],
    method VARCHAR,
    params JSONB,
    success BOOLEAN,
    error_message TEXT,
    total_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT g.id, 1 AS depth
          FROM organization.groups g
         WHERE g.organization_id = p_organization_id
           AND g.id = p_group_id
        UNION ALL
        SELECT child.id, tree.depth + 1
          FROM organization.groups child
          JOIN tree ON child.parent_group_id = tree.id
         WHERE child.organization_id = p_organization_id
           AND tree.depth < 64
           AND p_include_descendants
    ), ids_array AS (
        SELECT array_agg(DISTINCT dl.external_id)::TEXT[] AS ids
          FROM organization.group_members gm
          JOIN device.list dl
            ON dl.organization_id = gm.organization_id
           AND dl.id = gm.device_id
         WHERE gm.organization_id = p_organization_id
           AND gm.subject_type = 'device'
           AND gm.group_id IN (SELECT id FROM tree)
    ), matched AS (
        SELECT audit.*
          FROM logging.audit_log audit, ids_array scoped
         WHERE (p_from IS NULL OR audit.ts >= p_from)
           AND (p_to IS NULL OR audit.ts <= p_to)
           AND (p_event_types IS NULL OR audit.event_type = ANY(p_event_types))
           AND cardinality(scoped.ids) > 0
           AND (
               audit.shelly_id = ANY(scoped.ids)
               OR audit.shelly_ids && scoped.ids
           )
    ), counted AS (
        SELECT count(*)::BIGINT AS total_count FROM matched
    )
    SELECT matched.id,
           matched.ts,
           matched.event_type,
           matched.username,
           matched.shelly_id,
           matched.shelly_ids,
           matched.method,
           matched.params,
           matched.success,
           matched.error_message,
           counted.total_count
      FROM matched
      CROSS JOIN counted
     ORDER BY matched.ts DESC, matched.id DESC
     LIMIT p_limit OFFSET p_offset;
$$;
