--------------UP
-- p_include_summary: counts JSONB = {subject_type: n}; '{}' when no rows.
-- Per-bucket allowlist filters scope visible counts to caller's access.
DROP FUNCTION IF EXISTS organization.fn_tag_get(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION organization.fn_tag_get(
    p_organization_id       VARCHAR,
    p_id                    INTEGER,
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids     INTEGER[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    counts          JSONB
)
LANGUAGE sql
AS $$
    SELECT
        t.id, t.organization_id, t.key, t.name, t.description, t.color,
        t.icon, t.metadata, t.created_at, t.updated_at,
        CASE WHEN p_include_summary THEN
            COALESCE(
                (SELECT jsonb_object_agg(subject_type, c)
                 FROM (
                     SELECT ta.subject_type, COUNT(*) AS c
                     FROM organization.tag_assignments ta
                     WHERE ta.tag_id = t.id
                       AND ta.organization_id = p_organization_id
                       AND (
                           ta.subject_type NOT IN ('device','entity','group','location')
                           OR (ta.subject_type = 'device'
                               AND (p_allowed_device_ids IS NULL
                                    OR ta.subject_id = ANY(p_allowed_device_ids)))
                           OR (ta.subject_type = 'entity'
                               AND organization.fn_entity_belongs_to_device(ta.subject_id, p_allowed_device_ids))
                           OR (ta.subject_type = 'group'
                               AND (p_allowed_group_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_group_ids) AS x(id)
                                    )))
                           OR (ta.subject_type = 'location'
                               AND (p_allowed_location_ids IS NULL
                                    OR ta.subject_id IN (
                                        SELECT id::text FROM unnest(p_allowed_location_ids) AS x(id)
                                    )))
                       )
                     GROUP BY ta.subject_type
                 ) agg),
                '{}'::jsonb
            )
        END
    FROM organization.tags t
    WHERE t.id = p_id AND t.organization_id = p_organization_id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tag_get(VARCHAR, INTEGER, BOOLEAN, VARCHAR[], INTEGER[], INTEGER[]);
CREATE OR REPLACE FUNCTION organization.fn_tag_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT id, organization_id, key, name, description, color, icon, metadata,
           created_at, updated_at
    FROM organization.tags
    WHERE id = p_id AND organization_id = p_organization_id;
$$;
