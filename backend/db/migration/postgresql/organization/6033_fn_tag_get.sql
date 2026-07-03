--------------UP
CREATE OR REPLACE FUNCTION organization.fn_tag_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    key             VARCHAR,
    name            VARCHAR,
    description     VARCHAR,
    color           VARCHAR,
    icon            VARCHAR,
    metadata        JSONB,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT id, organization_id, key, name, description, color, icon, metadata,
           created_at, updated_at
    FROM organization.tags
    WHERE id = p_id AND organization_id = p_organization_id;
$$;
--------------DOWN
DROP FUNCTION organization.fn_tag_get;
