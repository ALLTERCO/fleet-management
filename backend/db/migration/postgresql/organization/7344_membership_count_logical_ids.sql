--------------UP
-- 7222 moved device/entity membership onto the durable device.list id and set
-- subject_id to NULL for those rows. The permission-scoped member counts still
-- compared subject_id against an allowlist of shelly_ids, so every device and
-- entity count collapsed to 0 for any caller with a restricted device scope.
--
-- One predicate replaces the two divergent checks it used to take (exact match
-- for device rows, prefix match for entity rows). Both now reduce to the same
-- question: is the row's device in the allowlist. Legacy entity rows that 7222
-- could not resolve keep no device_id, so they still fall back to the prefix
-- check on subject_id.

BEGIN;

CREATE OR REPLACE FUNCTION organization.fn_membership_subject_allowed(
    p_device_id           INTEGER,
    p_subject_id          VARCHAR,
    p_allowed_shelly_ids  VARCHAR[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT p_allowed_shelly_ids IS NULL
        OR (p_device_id IS NOT NULL AND EXISTS (
                SELECT 1
                  FROM device.list dl
                 WHERE dl.id = p_device_id
                   AND dl.external_id = ANY(p_allowed_shelly_ids)
           ))
        OR (p_device_id IS NULL
            AND organization.fn_entity_belongs_to_device(
                p_subject_id, p_allowed_shelly_ids
            ));
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_descendants_count(
    p_root_id                   INTEGER,
    p_organization_id           VARCHAR,
    p_subject_type              VARCHAR,
    p_allowed_subject_ids       VARCHAR[] DEFAULT NULL,
    p_allowed_device_prefixes   VARCHAR[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT id, 1 AS depth
        FROM organization.groups
        WHERE id = p_root_id AND organization_id = p_organization_id
        UNION ALL
        SELECT c.id, t.depth + 1
        FROM organization.groups c
        JOIN tree t ON c.parent_group_id = t.id
        WHERE c.organization_id = p_organization_id
          AND t.depth < 64
    )
    SELECT COUNT(*)::BIGINT
    FROM organization.group_members gm
    WHERE gm.organization_id = p_organization_id
      AND gm.subject_type = p_subject_type
      AND gm.group_id IN (SELECT id FROM tree)
      AND organization.fn_membership_subject_allowed(
              gm.device_id, gm.subject_id, p_allowed_subject_ids
          )
      AND organization.fn_membership_subject_allowed(
              gm.device_id, gm.subject_id, p_allowed_device_prefixes
          );
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_descendants_count(
    p_root_id                   INTEGER,
    p_organization_id           VARCHAR,
    p_subject_type              VARCHAR,
    p_allowed_subject_ids       VARCHAR[] DEFAULT NULL,
    p_allowed_device_prefixes   VARCHAR[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT id, 1 AS depth
        FROM organization.locations
        WHERE id = p_root_id AND organization_id = p_organization_id
        UNION ALL
        SELECT c.id, t.depth + 1
        FROM organization.locations c
        JOIN tree t ON c.parent_location_id = t.id
        WHERE c.organization_id = p_organization_id
          AND t.depth < 64
    )
    SELECT COUNT(*)::BIGINT
    FROM organization.location_assignments la
    WHERE la.organization_id = p_organization_id
      AND la.subject_type = p_subject_type
      AND la.location_id IN (SELECT id FROM tree)
      AND organization.fn_membership_subject_allowed(
              la.device_id, la.subject_id, p_allowed_subject_ids
          )
      AND organization.fn_membership_subject_allowed(
              la.device_id, la.subject_id, p_allowed_device_prefixes
          );
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_get(
    p_organization_id       VARCHAR,
    p_id                    INTEGER,
    p_include_summary       BOOLEAN   DEFAULT NULL,
    p_allowed_group_ids     INTEGER[] DEFAULT NULL,
    p_allowed_device_ids    VARCHAR[] DEFAULT NULL,
    p_allowed_location_ids  INTEGER[] DEFAULT NULL,
    p_allowed_tag_ids       INTEGER[] DEFAULT NULL,
    p_default_floor_standard    VARCHAR DEFAULT NULL,
    p_default_floor_operational VARCHAR DEFAULT NULL,
    p_default_floor_critical    VARCHAR DEFAULT NULL,
    p_default_floor_custom      VARCHAR DEFAULT NULL,
    p_default_retention_standard    INTEGER DEFAULT NULL,
    p_default_retention_operational INTEGER DEFAULT NULL,
    p_default_retention_critical    INTEGER DEFAULT NULL,
    p_default_retention_custom      INTEGER DEFAULT NULL,
    p_default_audit_retention_standard    INTEGER DEFAULT NULL,
    p_default_audit_retention_operational INTEGER DEFAULT NULL,
    p_default_audit_retention_critical    INTEGER DEFAULT NULL,
    p_default_audit_retention_custom      INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id                      INTEGER,
    organization_id         VARCHAR,
    name                    VARCHAR,
    description             VARCHAR,
    parent_group_id         INTEGER,
    group_type              VARCHAR,
    membership_mode         VARCHAR,
    kind                    TEXT,
    metadata                JSONB,
    visual_json             JSONB,
    image_asset_id          UUID,
    revision                BIGINT,
    is_legacy               BOOLEAN,
    effective_severity_floor        VARCHAR,
    effective_retention_days        INTEGER,
    effective_audit_retention_days  INTEGER,
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
        g.group_type, g.membership_mode, g.kind, g.metadata, g.visual_json,
        g.image_asset_id, g.revision, g.is_legacy,
        COALESCE(
            g.metadata->'policy'->>'severityFloor',
            (SELECT p.value FROM organization.group_type_policy p
              WHERE p.group_type = g.group_type AND p.field_key = 'severity_floor'),
            CASE g.group_type
                WHEN 'standard'    THEN p_default_floor_standard
                WHEN 'operational' THEN p_default_floor_operational
                WHEN 'critical'    THEN p_default_floor_critical
                WHEN 'custom'      THEN p_default_floor_custom
            END
        )::VARCHAR,
        COALESCE(
            (g.metadata->'policy'->>'retentionDays')::INTEGER,
            (SELECT p.value::INTEGER FROM organization.group_type_policy p
              WHERE p.group_type = g.group_type AND p.field_key = 'retention_days'),
            CASE g.group_type
                WHEN 'standard'    THEN p_default_retention_standard
                WHEN 'operational' THEN p_default_retention_operational
                WHEN 'critical'    THEN p_default_retention_critical
                WHEN 'custom'      THEN p_default_retention_custom
            END
        ),
        COALESCE(
            (g.metadata->'policy'->>'auditRetentionDays')::INTEGER,
            (SELECT p.value::INTEGER FROM organization.group_type_policy p
              WHERE p.group_type = g.group_type AND p.field_key = 'audit_retention_days'),
            CASE g.group_type
                WHEN 'standard'    THEN p_default_audit_retention_standard
                WHEN 'operational' THEN p_default_audit_retention_operational
                WHEN 'critical'    THEN p_default_audit_retention_critical
                WHEN 'custom'      THEN p_default_audit_retention_custom
            END
        ),
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
               AND organization.fn_membership_subject_allowed(
                       gm.device_id, gm.subject_id, p_allowed_device_ids
                   ))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = g.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'entity'
               AND organization.fn_membership_subject_allowed(
                       gm.device_id, gm.subject_id, p_allowed_device_ids
                   ))
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
    p_allowed_tag_ids       INTEGER[] DEFAULT NULL,
    p_default_floor_standard    VARCHAR DEFAULT NULL,
    p_default_floor_operational VARCHAR DEFAULT NULL,
    p_default_floor_critical    VARCHAR DEFAULT NULL,
    p_default_floor_custom      VARCHAR DEFAULT NULL,
    p_default_retention_standard    INTEGER DEFAULT NULL,
    p_default_retention_operational INTEGER DEFAULT NULL,
    p_default_retention_critical    INTEGER DEFAULT NULL,
    p_default_retention_custom      INTEGER DEFAULT NULL,
    p_default_audit_retention_standard    INTEGER DEFAULT NULL,
    p_default_audit_retention_operational INTEGER DEFAULT NULL,
    p_default_audit_retention_critical    INTEGER DEFAULT NULL,
    p_default_audit_retention_custom      INTEGER DEFAULT NULL
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
    kind                    TEXT,
    metadata                JSONB,
    visual_json             JSONB,
    image_asset_id          UUID,
    revision                BIGINT,
    is_legacy               BOOLEAN,
    effective_severity_floor        VARCHAR,
    effective_retention_days        INTEGER,
    effective_audit_retention_days  INTEGER,
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
        f.group_type, f.membership_mode, f.kind, f.metadata, f.visual_json,
        f.image_asset_id, f.revision, f.is_legacy,
        COALESCE(
            f.metadata->'policy'->>'severityFloor',
            (SELECT p.value FROM organization.group_type_policy p
              WHERE p.group_type = f.group_type AND p.field_key = 'severity_floor'),
            CASE f.group_type
                WHEN 'standard'    THEN p_default_floor_standard
                WHEN 'operational' THEN p_default_floor_operational
                WHEN 'critical'    THEN p_default_floor_critical
                WHEN 'custom'      THEN p_default_floor_custom
            END
        )::VARCHAR,
        COALESCE(
            (f.metadata->'policy'->>'retentionDays')::INTEGER,
            (SELECT p.value::INTEGER FROM organization.group_type_policy p
              WHERE p.group_type = f.group_type AND p.field_key = 'retention_days'),
            CASE f.group_type
                WHEN 'standard'    THEN p_default_retention_standard
                WHEN 'operational' THEN p_default_retention_operational
                WHEN 'critical'    THEN p_default_retention_critical
                WHEN 'custom'      THEN p_default_retention_custom
            END
        ),
        COALESCE(
            (f.metadata->'policy'->>'auditRetentionDays')::INTEGER,
            (SELECT p.value::INTEGER FROM organization.group_type_policy p
              WHERE p.group_type = f.group_type AND p.field_key = 'audit_retention_days'),
            CASE f.group_type
                WHEN 'standard'    THEN p_default_audit_retention_standard
                WHEN 'operational' THEN p_default_audit_retention_operational
                WHEN 'critical'    THEN p_default_audit_retention_critical
                WHEN 'custom'      THEN p_default_audit_retention_custom
            END
        ),
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
               AND organization.fn_membership_subject_allowed(
                       gm.device_id, gm.subject_id, p_allowed_device_ids
                   ))
        END,
        CASE WHEN p_include_summary THEN
            (SELECT COUNT(*) FROM organization.group_members gm
             WHERE gm.group_id = f.id
               AND gm.organization_id = p_organization_id
               AND gm.subject_type = 'entity'
               AND organization.fn_membership_subject_allowed(
                       gm.device_id, gm.subject_id, p_allowed_device_ids
                   ))
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

COMMIT;

--------------DOWN
BEGIN;

CREATE OR REPLACE FUNCTION organization.fn_group_descendants_count(
    p_root_id                   INTEGER,
    p_organization_id           VARCHAR,
    p_subject_type              VARCHAR,
    p_allowed_subject_ids       VARCHAR[] DEFAULT NULL,
    p_allowed_device_prefixes   VARCHAR[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT id, 1 AS depth
        FROM organization.groups
        WHERE id = p_root_id AND organization_id = p_organization_id
        UNION ALL
        SELECT c.id, t.depth + 1
        FROM organization.groups c
        JOIN tree t ON c.parent_group_id = t.id
        WHERE c.organization_id = p_organization_id
          AND t.depth < 64
    )
    SELECT COUNT(*)::BIGINT
    FROM organization.group_members gm
    WHERE gm.organization_id = p_organization_id
      AND gm.subject_type = p_subject_type
      AND gm.group_id IN (SELECT id FROM tree)
      AND (p_allowed_subject_ids IS NULL
           OR gm.subject_id = ANY(p_allowed_subject_ids))
      AND organization.fn_entity_belongs_to_device(gm.subject_id, p_allowed_device_prefixes);
$$;

CREATE OR REPLACE FUNCTION organization.fn_location_descendants_count(
    p_root_id                   INTEGER,
    p_organization_id           VARCHAR,
    p_subject_type              VARCHAR,
    p_allowed_subject_ids       VARCHAR[] DEFAULT NULL,
    p_allowed_device_prefixes   VARCHAR[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
    WITH RECURSIVE tree AS (
        SELECT id, 1 AS depth
        FROM organization.locations
        WHERE id = p_root_id AND organization_id = p_organization_id
        UNION ALL
        SELECT c.id, t.depth + 1
        FROM organization.locations c
        JOIN tree t ON c.parent_location_id = t.id
        WHERE c.organization_id = p_organization_id
          AND t.depth < 64
    )
    SELECT COUNT(*)::BIGINT
    FROM organization.location_assignments la
    WHERE la.organization_id = p_organization_id
      AND la.subject_type = p_subject_type
      AND la.location_id IN (SELECT id FROM tree)
      AND (p_allowed_subject_ids IS NULL
           OR la.subject_id = ANY(p_allowed_subject_ids))
      AND organization.fn_entity_belongs_to_device(la.subject_id, p_allowed_device_prefixes);
$$;

DROP FUNCTION IF EXISTS organization.fn_membership_subject_allowed(
    INTEGER, VARCHAR, VARCHAR[]
);

COMMIT;
