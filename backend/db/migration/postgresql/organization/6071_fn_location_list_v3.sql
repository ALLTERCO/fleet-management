--------------UP
-- p_include_summary: CASE guards keep count subqueries lazy.
-- Allowlist params (NULL = no filter) scope row-level + per-count access.
DROP FUNCTION IF EXISTS organization.fn_location_list(VARCHAR, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER[]);
CREATE OR REPLACE FUNCTION organization.fn_location_list(
    p_organization_id      VARCHAR,
    p_parent_id            INTEGER   DEFAULT NULL,
    p_roots_only           BOOLEAN   DEFAULT FALSE,
    p_limit                INTEGER   DEFAULT 200,
    p_offset               INTEGER   DEFAULT 0,
    p_allowed_ids          INTEGER[] DEFAULT NULL,
    p_include_summary      BOOLEAN   DEFAULT NULL,
    p_allowed_device_ids   VARCHAR[] DEFAULT NULL,
    p_allowed_group_ids    INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids      INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count                 BIGINT,
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
    WITH filtered AS (
        SELECT l.*
        FROM organization.locations l
        WHERE l.organization_id = p_organization_id
          AND (
              p_roots_only IS FALSE AND p_parent_id IS NULL
              OR (p_roots_only IS TRUE AND l.parent_location_id IS NULL)
              OR (p_roots_only IS FALSE AND l.parent_location_id = p_parent_id)
          )
          AND (p_allowed_ids IS NULL OR l.id = ANY(p_allowed_ids))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.id, f.organization_id, f.name, f.kind, f.parent_location_id,
        f.sort_order, f.timezone, f.address, f.location_code, f.geo,
        f.metadata, f.created_at, f.updated_at,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.locations c
             WHERE c.parent_location_id = f.id
               AND c.organization_id = p_organization_id
               AND (p_allowed_ids IS NULL OR c.id = ANY(p_allowed_ids)))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.location_assignments la
             WHERE la.location_id = f.id
               AND la.organization_id = p_organization_id
               AND la.subject_type = 'device'
               AND (p_allowed_device_ids IS NULL OR la.subject_id = ANY(p_allowed_device_ids)))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.location_assignments la
             WHERE la.location_id = f.id
               AND la.organization_id = p_organization_id
               AND la.subject_type = 'entity'
               AND organization.fn_entity_belongs_to_device(la.subject_id, p_allowed_device_ids))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.tag_assignments ta
             WHERE ta.organization_id = p_organization_id
               AND ta.subject_type = 'location'
               AND ta.subject_id = f.id::text
               AND (p_allowed_tag_ids IS NULL OR ta.tag_id = ANY(p_allowed_tag_ids)))
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_location_descendants_count(
                f.id, p_organization_id, 'device', p_allowed_device_ids
            )
        END,
        CASE WHEN p_include_summary THEN
            organization.fn_location_descendants_count(
                f.id, p_organization_id, 'entity', NULL, p_allowed_device_ids
            )
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.organization_id = p_organization_id
               AND gm.subject_type = 'location'
               AND gm.subject_id = f.id::text
               AND (p_allowed_group_ids IS NULL OR gm.group_id = ANY(p_allowed_group_ids)))
        END
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY sort_order ASC, name ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_location_list(VARCHAR, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER[], BOOLEAN, VARCHAR[], INTEGER[], INTEGER[]);
CREATE OR REPLACE FUNCTION organization.fn_location_list(
    p_organization_id VARCHAR,
    p_parent_id       INTEGER DEFAULT NULL,
    p_roots_only      BOOLEAN DEFAULT FALSE,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0,
    p_allowed_ids     INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    total_count         BIGINT,
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
    WITH filtered AS (
        SELECT l.*
        FROM organization.locations l
        WHERE l.organization_id = p_organization_id
          AND (
              p_roots_only IS FALSE AND p_parent_id IS NULL
              OR (p_roots_only IS TRUE AND l.parent_location_id IS NULL)
              OR (p_roots_only IS FALSE AND l.parent_location_id = p_parent_id)
          )
          AND (p_allowed_ids IS NULL OR l.id = ANY(p_allowed_ids))
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        total.c AS total_count,
        f.id, f.organization_id, f.name, f.kind, f.parent_location_id,
        f.sort_order, f.timezone, f.address, f.location_code, f.geo,
        f.metadata, f.created_at, f.updated_at
    FROM total
    LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY sort_order ASC, name ASC
        LIMIT p_limit OFFSET p_offset
    ) f ON TRUE;
$$;
