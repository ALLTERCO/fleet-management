--------------UP
-- p_include_summary: CASE guards keep count subqueries lazy.
-- Allowlist params (NULL = no filter) scope counts to caller's visibility.
DROP FUNCTION IF EXISTS organization.fn_location_get(VARCHAR, INTEGER);

CREATE OR REPLACE FUNCTION organization.fn_location_get(
    p_organization_id         VARCHAR,
    p_id                      INTEGER,
    p_include_summary         BOOLEAN   DEFAULT NULL,
    p_allowed_location_ids    INTEGER[] DEFAULT NULL,
    p_allowed_device_ids      VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids       INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids         INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    id                          INTEGER,
    organization_id             VARCHAR,
    name                        VARCHAR,
    kind                        VARCHAR,
    parent_location_id          INTEGER,
    sort_order                  INTEGER,
    timezone                    VARCHAR,
    address                     JSONB,
    location_code               VARCHAR,
    geo                         JSONB,
    metadata                    JSONB,
    created_at                  TIMESTAMPTZ,
    updated_at                  TIMESTAMPTZ,
    c_child_locations           BIGINT,
    c_devices                   BIGINT,
    c_entities                  BIGINT,
    c_tags                      BIGINT,
    c_descendant_devices        BIGINT,
    c_descendant_entities       BIGINT,
    c_groups_referencing        BIGINT
)
LANGUAGE sql
AS $$
    SELECT
        l.id, l.organization_id, l.name, l.kind, l.parent_location_id,
        l.sort_order, l.timezone, l.address, l.location_code, l.geo,
        l.metadata, l.created_at, l.updated_at,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.locations c
             WHERE c.parent_location_id = l.id
               AND c.organization_id = p_organization_id
               AND (p_allowed_location_ids IS NULL OR c.id = ANY(p_allowed_location_ids)))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.location_assignments la
             WHERE la.location_id = l.id
               AND la.organization_id = p_organization_id
               AND la.subject_type = 'device'
               AND (p_allowed_device_ids IS NULL OR la.subject_id = ANY(p_allowed_device_ids)))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.location_assignments la
             WHERE la.location_id = l.id
               AND la.organization_id = p_organization_id
               AND la.subject_type = 'entity'
               AND organization.fn_entity_belongs_to_device(la.subject_id, p_allowed_device_ids))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.tag_assignments ta
             WHERE ta.organization_id = p_organization_id
               AND ta.subject_type = 'location'
               AND ta.subject_id = l.id::text
               AND (p_allowed_tag_ids IS NULL OR ta.tag_id = ANY(p_allowed_tag_ids)))
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_location_descendants_count(
                l.id, p_organization_id, 'device', p_allowed_device_ids
            )
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_location_descendants_count(
                l.id, p_organization_id, 'entity', NULL, p_allowed_device_ids
            )
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.organization_id = p_organization_id
               AND gm.subject_type = 'location'
               AND gm.subject_id = l.id::text
               AND (p_allowed_group_ids IS NULL OR gm.group_id = ANY(p_allowed_group_ids)))
        END
    FROM organization.locations l
    WHERE l.id = p_id AND l.organization_id = p_organization_id;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_get(VARCHAR, INTEGER, BOOLEAN, INTEGER[], VARCHAR[], INTEGER[], INTEGER[]);
CREATE OR REPLACE FUNCTION organization.fn_location_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id                  INTEGER,
    organization_id     VARCHAR,
    name                VARCHAR,
    kind                VARCHAR,
    parent_location_id  INTEGER,
    sort_order          INTEGER,
    timezone            VARCHAR,
    address             JSONB,
    location_code       VARCHAR,
    geo                 JSONB,
    metadata            JSONB,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT id, organization_id, name, kind, parent_location_id, sort_order,
           timezone, address, location_code, geo, metadata, created_at, updated_at
    FROM organization.locations
    WHERE id = p_id AND organization_id = p_organization_id;
$$;
