--------------UP
-- Fix two defects in 6087/6088 caught by api-tests:
--   1) fn_group_create: bare `id` in the parent-exists check is ambiguous
--      on PG 17 because RETURNS TABLE(id,...) declares it as OUT param.
--   2) fn_group_update: `metadata->>'severityFloor'` yields TEXT but the
--      RETURNS TABLE column is VARCHAR — PG rejects as a shape mismatch.
--      And `RETURN QUERY SELECT v_row.*` returned a one-NULL-row shape
--      when the UPDATE matched nothing, swallowing GroupNotFound.
-- Rewrite both to `RETURN QUERY INSERT/UPDATE ... RETURNING ...` with
-- aliased target + explicit VARCHAR casts. Zero-row outcome is natural.

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
    p_default_retention_custom      INTEGER DEFAULT NULL
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
    effective_severity_floor VARCHAR,
    effective_retention_days INTEGER,
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
            CASE g.group_type
                WHEN 'standard'    THEN p_default_floor_standard
                WHEN 'operational' THEN p_default_floor_operational
                WHEN 'critical'    THEN p_default_floor_critical
                WHEN 'custom'      THEN p_default_floor_custom
            END
        ))::VARCHAR,
        COALESCE(
            (g.metadata->'policy'->>'retentionDays')::INTEGER,
            CASE g.group_type
                WHEN 'standard'    THEN p_default_retention_standard
                WHEN 'operational' THEN p_default_retention_operational
                WHEN 'critical'    THEN p_default_retention_critical
                WHEN 'custom'      THEN p_default_retention_custom
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
    p_default_retention_custom      INTEGER DEFAULT NULL
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
    effective_severity_floor VARCHAR,
    effective_retention_days INTEGER,
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
            CASE g.group_type
                WHEN 'standard'    THEN p_default_floor_standard
                WHEN 'operational' THEN p_default_floor_operational
                WHEN 'critical'    THEN p_default_floor_critical
                WHEN 'custom'      THEN p_default_floor_custom
            END
        ))::VARCHAR,
        COALESCE(
            (g.metadata->'policy'->>'retentionDays')::INTEGER,
            CASE g.group_type
                WHEN 'standard'    THEN p_default_retention_standard
                WHEN 'operational' THEN p_default_retention_operational
                WHEN 'critical'    THEN p_default_retention_critical
                WHEN 'custom'      THEN p_default_retention_custom
            END
        ),
        g.created_at, g.updated_at;
END;
$$;
--------------DOWN
-- Prior signatures exist as 6087/6088; nothing to restore explicitly.
