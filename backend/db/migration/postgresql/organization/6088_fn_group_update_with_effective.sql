--------------UP
-- fn_group_update: add effective_severity_floor + effective_retention_days to
-- the return shape so it matches fn_group_get / fn_group_list / fn_group_create.
DROP FUNCTION IF EXISTS organization.fn_group_update(
    VARCHAR, INTEGER, VARCHAR, VARCHAR, BOOLEAN, INTEGER, BOOLEAN, VARCHAR, JSONB
);
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
    v_row organization.groups%ROWTYPE;
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
            SELECT 1 FROM organization.groups
            WHERE id = v_new_parent
              AND organization_id = p_organization_id
        ) THEN
            RAISE EXCEPTION 'parent_group_id % not found in organization %',
                v_new_parent, p_organization_id
                USING ERRCODE = '22023';
        END IF;

        WITH RECURSIVE ancestors AS (
            SELECT g.id, g.parent_group_id, 1 AS depth
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
        SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = p_id)
        INTO v_cycle_found;

        IF v_cycle_found THEN
            RAISE EXCEPTION 'parent change would create a cycle'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE organization.groups SET
        name        = COALESCE(p_name, groups.name),
        description = CASE
            WHEN p_clear_description THEN NULL
            WHEN p_description IS NOT NULL THEN p_description
            ELSE groups.description
        END,
        parent_group_id = CASE
            WHEN p_clear_parent THEN NULL
            WHEN p_parent_group_id IS NOT NULL THEN p_parent_group_id
            ELSE groups.parent_group_id
        END,
        group_type  = COALESCE(p_group_type, groups.group_type),
        metadata    = COALESCE(p_metadata, groups.metadata),
        updated_at  = NOW()
    WHERE groups.id = p_id AND groups.organization_id = p_organization_id
    RETURNING * INTO v_row;

    RETURN QUERY
    SELECT
        v_row.id, v_row.organization_id, v_row.name, v_row.description,
        v_row.parent_group_id, v_row.group_type, v_row.membership_mode,
        v_row.metadata, v_row.is_legacy,
        COALESCE(
            v_row.metadata->'policy'->>'severityFloor',
            CASE v_row.group_type
                WHEN 'standard'    THEN p_default_floor_standard
                WHEN 'operational' THEN p_default_floor_operational
                WHEN 'critical'    THEN p_default_floor_critical
                WHEN 'custom'      THEN p_default_floor_custom
            END
        ),
        COALESCE(
            (v_row.metadata->'policy'->>'retentionDays')::INTEGER,
            CASE v_row.group_type
                WHEN 'standard'    THEN p_default_retention_standard
                WHEN 'operational' THEN p_default_retention_operational
                WHEN 'critical'    THEN p_default_retention_critical
                WHEN 'custom'      THEN p_default_retention_custom
            END
        ),
        v_row.created_at, v_row.updated_at;
END;
$$;
--------------DOWN
-- Previous signatures exist as 6082; nothing to restore explicitly.
