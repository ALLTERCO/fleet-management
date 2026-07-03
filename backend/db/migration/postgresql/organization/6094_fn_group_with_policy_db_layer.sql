--------------UP
-- Insert group_type_policy lookup between override and env fallback in
-- fn_group_{get,list,create,update}. Same signatures, extra COALESCE layer.

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
    metadata                JSONB,
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
        g.group_type, g.membership_mode, g.metadata, g.is_legacy,
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
    metadata                JSONB,
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
        f.group_type, f.membership_mode, f.metadata, f.is_legacy,
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

CREATE OR REPLACE FUNCTION organization.fn_group_create(
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_description     VARCHAR DEFAULT NULL,
    p_parent_group_id INTEGER DEFAULT NULL,
    p_group_type      VARCHAR DEFAULT 'standard',
    p_metadata        JSONB   DEFAULT '{}'::jsonb,
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
    id                INTEGER,
    organization_id   VARCHAR,
    name              VARCHAR,
    description       VARCHAR,
    parent_group_id   INTEGER,
    group_type        VARCHAR,
    membership_mode   VARCHAR,
    metadata          JSONB,
    is_legacy         BOOLEAN,
    effective_severity_floor        VARCHAR,
    effective_retention_days        INTEGER,
    effective_audit_retention_days  INTEGER,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    IF p_parent_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.groups g
        WHERE g.id = p_parent_group_id
          AND g.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'parent_group_id % not found in organization %',
            p_parent_group_id, p_organization_id
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    INSERT INTO organization.groups AS g (
        organization_id, name, description, parent_group_id,
        group_type, metadata
    )
    VALUES (
        p_organization_id, p_name, p_description, p_parent_group_id,
        COALESCE(p_group_type, 'standard'),
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING
        g.id, g.organization_id, g.name, g.description,
        g.parent_group_id, g.group_type, g.membership_mode,
        g.metadata, g.is_legacy,
        (COALESCE(
            g.metadata->'policy'->>'severityFloor',
            (SELECT p.value FROM organization.group_type_policy p
              WHERE p.group_type = g.group_type AND p.field_key = 'severity_floor'),
            CASE g.group_type
                WHEN 'standard'    THEN p_default_floor_standard
                WHEN 'operational' THEN p_default_floor_operational
                WHEN 'critical'    THEN p_default_floor_critical
                WHEN 'custom'      THEN p_default_floor_custom
            END
        ))::VARCHAR,
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
        g.created_at, g.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION organization.fn_group_update(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_name            VARCHAR DEFAULT NULL,
    p_description     VARCHAR DEFAULT NULL,
    p_clear_description BOOLEAN DEFAULT FALSE,
    p_parent_group_id INTEGER DEFAULT NULL,
    p_clear_parent    BOOLEAN DEFAULT FALSE,
    p_group_type      VARCHAR DEFAULT NULL,
    p_metadata        JSONB   DEFAULT NULL,
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
    id                INTEGER,
    organization_id   VARCHAR,
    name              VARCHAR,
    description       VARCHAR,
    parent_group_id   INTEGER,
    group_type        VARCHAR,
    membership_mode   VARCHAR,
    metadata          JSONB,
    is_legacy         BOOLEAN,
    effective_severity_floor        VARCHAR,
    effective_retention_days        INTEGER,
    effective_audit_retention_days  INTEGER,
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_parent INTEGER;
    v_cycle_found BOOLEAN;
    v_is_legacy BOOLEAN;
    v_current_parent INTEGER;
    v_parent_change_requested BOOLEAN;
BEGIN
    IF p_clear_parent THEN
        v_new_parent := NULL;
    ELSE
        v_new_parent := p_parent_group_id;
    END IF;

    SELECT g.is_legacy, g.parent_group_id
      INTO v_is_legacy, v_current_parent
      FROM organization.groups g
     WHERE g.id = p_id AND g.organization_id = p_organization_id;

    v_parent_change_requested :=
        (p_clear_parent AND v_current_parent IS NOT NULL)
        OR (NOT p_clear_parent
            AND p_parent_group_id IS NOT NULL
            AND p_parent_group_id IS DISTINCT FROM v_current_parent);

    IF v_is_legacy AND v_parent_change_requested THEN
        RAISE EXCEPTION 'legacy group % cannot change hierarchy', p_id
            USING ERRCODE = 'FM001';
    END IF;

    IF v_new_parent IS NOT NULL THEN
        IF v_new_parent = p_id THEN
            RAISE EXCEPTION 'group cannot be its own parent'
                USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM organization.groups g
            WHERE g.id = v_new_parent
              AND g.organization_id = p_organization_id
        ) THEN
            RAISE EXCEPTION 'parent_group_id % not found in organization %',
                v_new_parent, p_organization_id
                USING ERRCODE = '22023';
        END IF;

        WITH RECURSIVE ancestors AS (
            SELECT g.id AS gid, g.parent_group_id, 1 AS depth
            FROM organization.groups g
            WHERE g.id = v_new_parent
              AND g.organization_id = p_organization_id
            UNION ALL
            SELECT g.id, g.parent_group_id, a.depth + 1
            FROM organization.groups g
            JOIN ancestors a ON g.id = a.parent_group_id
            WHERE g.organization_id = p_organization_id
              AND a.depth < 64
        )
        SELECT EXISTS (SELECT 1 FROM ancestors a WHERE a.gid = p_id)
        INTO v_cycle_found;

        IF v_cycle_found THEN
            RAISE EXCEPTION 'parent change would create a cycle'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    RETURN QUERY
    UPDATE organization.groups AS g SET
        name        = COALESCE(p_name, g.name),
        description = CASE
            WHEN p_clear_description THEN NULL
            WHEN p_description IS NOT NULL THEN p_description
            ELSE g.description
        END,
        parent_group_id = CASE
            WHEN p_clear_parent THEN NULL
            WHEN p_parent_group_id IS NOT NULL THEN p_parent_group_id
            ELSE g.parent_group_id
        END,
        group_type  = COALESCE(p_group_type, g.group_type),
        metadata    = COALESCE(p_metadata, g.metadata),
        updated_at  = NOW()
    WHERE g.id = p_id AND g.organization_id = p_organization_id
    RETURNING
        g.id, g.organization_id, g.name, g.description,
        g.parent_group_id, g.group_type, g.membership_mode,
        g.metadata, g.is_legacy,
        (COALESCE(
            g.metadata->'policy'->>'severityFloor',
            (SELECT p.value FROM organization.group_type_policy p
              WHERE p.group_type = g.group_type AND p.field_key = 'severity_floor'),
            CASE g.group_type
                WHEN 'standard'    THEN p_default_floor_standard
                WHEN 'operational' THEN p_default_floor_operational
                WHEN 'critical'    THEN p_default_floor_critical
                WHEN 'custom'      THEN p_default_floor_custom
            END
        ))::VARCHAR,
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
        g.created_at, g.updated_at;
END;
$$;
--------------DOWN
-- Previous 3-param-free signatures exist as 6091; nothing to restore explicitly.
