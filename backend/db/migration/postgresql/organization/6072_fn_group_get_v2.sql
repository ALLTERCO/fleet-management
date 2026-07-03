--------------UP
-- p_include_summary: direct-child + member subject counts + descendants.
-- Allowlist params (NULL = no filter) scope counts to caller's visibility.
DROP FUNCTION IF EXISTS organization.fn_group_get(VARCHAR, INTEGER);
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
        g.group_type, g.membership_mode, g.metadata, g.created_at, g.updated_at,
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
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_group_get(VARCHAR, INTEGER, BOOLEAN, INTEGER[], VARCHAR[], INTEGER[], INTEGER[]);
CREATE OR REPLACE FUNCTION organization.fn_group_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id                INTEGER,
    organization_id   VARCHAR,
    name              VARCHAR,
    description       VARCHAR,
    parent_group_id   INTEGER,
    group_type        VARCHAR,
    membership_mode   VARCHAR,
    metadata          JSONB,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT id, organization_id, name, description, parent_group_id,
           group_type, membership_mode, metadata, created_at, updated_at
    FROM organization.groups
    WHERE id = p_id AND organization_id = p_organization_id;
$$;
