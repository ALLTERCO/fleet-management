--------------UP
-- fn_group_create: return effective_severity_floor + effective_retention_days
-- so newly-created rows have the same shape as get/list responses.
DROP FUNCTION IF EXISTS organization.fn_group_create(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, VARCHAR, JSONB
);
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
DECLARE
    v_row organization.groups%ROWTYPE;
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    -- Alias required — RETURNS TABLE(id, ...) creates OUT params that
    -- shadow bare column refs on PG 17.
    IF p_parent_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.groups g
        WHERE g.id = p_parent_group_id
          AND g.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'parent_group_id % not found in organization %',
            p_parent_group_id, p_organization_id
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO organization.groups (
        organization_id, name, description, parent_group_id,
        group_type, metadata
    )
    VALUES (
        p_organization_id, p_name, p_description, p_parent_group_id,
        COALESCE(p_group_type, 'standard'),
        COALESCE(p_metadata, '{}'::jsonb)
    )
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
-- Legacy v2 signature exists as 6084; nothing to restore.
