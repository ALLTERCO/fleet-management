--------------UP
-- fn_group_create: return is_legacy (always FALSE for new rows) so callers
-- get the same row shape as fn_group_get / fn_group_list.
DROP FUNCTION IF EXISTS organization.fn_group_create(
    VARCHAR, VARCHAR, VARCHAR, INTEGER, VARCHAR, JSONB
);
CREATE OR REPLACE FUNCTION organization.fn_group_create(
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_description     VARCHAR DEFAULT NULL,
    p_parent_group_id INTEGER DEFAULT NULL,
    p_group_type      VARCHAR DEFAULT 'standard',
    p_metadata        JSONB   DEFAULT '{}'::jsonb
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
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    IF p_parent_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization.groups
        WHERE id = p_parent_group_id
          AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'parent_group_id % not found in organization %',
            p_parent_group_id, p_organization_id
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    INSERT INTO organization.groups (
        organization_id, name, description, parent_group_id,
        group_type, metadata
    )
    VALUES (
        p_organization_id, p_name, p_description, p_parent_group_id,
        COALESCE(p_group_type, 'standard'),
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING groups.id, groups.organization_id, groups.name, groups.description,
              groups.parent_group_id, groups.group_type, groups.membership_mode,
              groups.metadata, groups.is_legacy,
              groups.created_at, groups.updated_at;
END;
$$;
--------------DOWN
-- v2 signature without is_legacy already exists as 6040; nothing to restore.
