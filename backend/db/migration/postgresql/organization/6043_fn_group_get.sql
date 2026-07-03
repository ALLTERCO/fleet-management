--------------UP
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
--------------DOWN
DROP FUNCTION organization.fn_group_get;
