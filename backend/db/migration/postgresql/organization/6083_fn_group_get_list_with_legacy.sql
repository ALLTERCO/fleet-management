--------------UP
-- Surface `is_legacy` through fn_group_get / fn_group_list. Callers use it
-- to disable the hierarchy-change UI and to render the "legacy" badge.
DROP FUNCTION IF EXISTS organization.fn_group_get(
    VARCHAR, INTEGER, BOOLEAN, INTEGER[], VARCHAR[], INTEGER[], INTEGER[]
);
CREATE OR REPLACE FUNCTION organization.fn_group_get(
    p_organization_id       VARCHAR,
    p_id                    INTEGER,
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_group_ids     INTEGER[] DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids       INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    id                      INTEGER,
    organization_id         VARCHAR,
    name                    VARCHAR,
    description             VARCHAR,
    parent_group_id         INTEGER,
    group_type              VARCHAR,
    membership_mode         VARCHAR,
    metadata                JSONB,
    is_legacy               BOOLEAN,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ,
    c_child_groups          BIGINT,
    c_devices               BIGINT,
    c_entities              BIGINT,
    c_locations             BIGINT,
    c_tags                  BIGINT,
    c_descendant_devices    BIGINT,
    c_descendant_entities   BIGINT
)
LANGUAGE sql
AS $$
    SELECT
        g.id, g.organization_id, g.name, g.description, g.parent_group_id,
        g.group_type, g.membership_mode, g.metadata, g.is_legacy,
        g.created_at, g.updated_at,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.groups c
             WHERE c.parent_group_id = g.id
               AND c.organization_id = p_organization_id
               AND (p_allowed_group_ids IS NULL OR c.id = ANY(p_allowed_group_ids)))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = g.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'device'
               AND (p_allowed_device_ids IS NULL OR gm.subject_id = ANY(p_allowed_device_ids)))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = g.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'entity'
               AND organization.fn_entity_belongs_to_device(gm.subject_id, p_allowed_device_ids))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = g.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'location'
               AND (p_allowed_location_ids IS NULL OR gm.subject_id IN (
                   SELECT id::text FROM unnest(p_allowed_location_ids) AS t(id)
               )))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.tag_assignments ta
             WHERE ta.organization_id = p_organization_id
               AND ta.subject_type = 'group'
               AND ta.subject_id = g.id::text
               AND (p_allowed_tag_ids IS NULL OR ta.tag_id = ANY(p_allowed_tag_ids)))
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_group_descendants_count(
                g.id, p_organization_id, 'device', p_allowed_device_ids
            )
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_group_descendants_count(
                g.id, p_organization_id, 'entity', NULL, p_allowed_device_ids
            )
        END
    FROM organization.groups g
    WHERE g.id = p_id AND g.organization_id = p_organization_id;
$$;

DROP FUNCTION IF EXISTS organization.fn_group_list(
    VARCHAR, INTEGER, BOOLEAN, VARCHAR, VARCHAR, INTEGER, INTEGER,
    VARCHAR, VARCHAR, INTEGER[], BOOLEAN, VARCHAR[], INTEGER[], INTEGER[]
);
CREATE OR REPLACE FUNCTION organization.fn_group_list(
    p_organization_id       VARCHAR,
    p_parent_id             INTEGER   DEFAULT NULL,
    p_roots_only            BOOLEAN   DEFAULT FALSE,
    p_query                 VARCHAR   DEFAULT NULL,
    p_group_type            VARCHAR   DEFAULT NULL,
    p_limit                 INTEGER   DEFAULT 200,
    p_offset                INTEGER   DEFAULT 0,
    p_sort_by               VARCHAR   DEFAULT 'name',
    p_sort_dir              VARCHAR   DEFAULT 'asc',
    p_allowed_ids           INTEGER[] DEFAULT NULL,
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids       INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count             BIGINT,
    id                      INTEGER,
    organization_id         VARCHAR,
    name                    VARCHAR,
    description             VARCHAR,
    parent_group_id         INTEGER,
    group_type              VARCHAR,
    membership_mode         VARCHAR,
    metadata                JSONB,
    is_legacy               BOOLEAN,
    created_at              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ,
    c_child_groups          BIGINT,
    c_devices               BIGINT,
    c_entities              BIGINT,
    c_locations             BIGINT,
    c_tags                  BIGINT,
    c_descendant_devices    BIGINT,
    c_descendant_entities   BIGINT
)
LANGUAGE sql
AS $$
    WITH filtered AS (
        SELECT g.*
        FROM organization.groups g
        WHERE g.organization_id = p_organization_id
          AND (
              (p_roots_only IS FALSE AND p_parent_id IS NULL)
              OR (p_roots_only IS TRUE  AND g.parent_group_id IS NULL)
              OR (p_roots_only IS FALSE AND g.parent_group_id = p_parent_id)
          )
          AND (p_group_type IS NULL OR g.group_type = p_group_type)
          AND (p_query IS NULL OR g.name ILIKE '%' || p_query || '%')
          AND (p_allowed_ids IS NULL OR g.id = ANY(p_allowed_ids))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.id, f.organization_id, f.name, f.description, f.parent_group_id,
        f.group_type, f.membership_mode, f.metadata, f.is_legacy,
        f.created_at, f.updated_at,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.groups c
             WHERE c.parent_group_id = f.id
               AND c.organization_id = p_organization_id
               AND (p_allowed_ids IS NULL OR c.id = ANY(p_allowed_ids)))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = f.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'device'
               AND (p_allowed_device_ids IS NULL OR gm.subject_id = ANY(p_allowed_device_ids)))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = f.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'entity'
               AND organization.fn_entity_belongs_to_device(gm.subject_id, p_allowed_device_ids))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = f.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'location'
               AND (p_allowed_location_ids IS NULL OR gm.subject_id IN (
                   SELECT id::text FROM unnest(p_allowed_location_ids) AS t(id)
               )))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.tag_assignments ta
             WHERE ta.organization_id = p_organization_id
               AND ta.subject_type = 'group'
               AND ta.subject_id = f.id::text
               AND (p_allowed_tag_ids IS NULL OR ta.tag_id = ANY(p_allowed_tag_ids)))
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_group_descendants_count(
                f.id, p_organization_id, 'device', p_allowed_device_ids
            )
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_group_descendants_count(
                f.id, p_organization_id, 'entity', NULL, p_allowed_device_ids
            )
        END
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'asc'  THEN name       END ASC,
            CASE WHEN p_sort_by = 'name'       AND p_sort_dir = 'desc' THEN name       END DESC,
            CASE WHEN p_sort_by = 'group_type' AND p_sort_dir = 'asc'  THEN group_type END ASC,
            CASE WHEN p_sort_by = 'group_type' AND p_sort_dir = 'desc' THEN group_type END DESC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN created_at END DESC,
            CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc'  THEN created_at END ASC,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'desc' THEN updated_at END DESC,
            CASE WHEN p_sort_by = 'updated_at' AND p_sort_dir = 'asc'  THEN updated_at END ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
--------------DOWN
-- v2 signatures without is_legacy already exist as 6072/6073; nothing to restore.
