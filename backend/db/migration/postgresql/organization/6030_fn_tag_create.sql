--------------UP
CREATE OR REPLACE FUNCTION organization.fn_tag_create(
    p_organization_id VARCHAR,
    p_key             VARCHAR,
    p_name            VARCHAR,
    p_description     VARCHAR DEFAULT NULL,
    p_color           VARCHAR DEFAULT NULL,
    p_icon            VARCHAR DEFAULT NULL,
    p_metadata        JSONB   DEFAULT '{}'::jsonb
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
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    RETURN QUERY
    INSERT INTO organization.tags (
        organization_id, key, name, description, color, icon, metadata
    )
    VALUES (
        p_organization_id, p_key, p_name, p_description, p_color, p_icon,
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING tags.id, tags.organization_id, tags.key, tags.name,
              tags.description, tags.color, tags.icon, tags.metadata,
              tags.created_at, tags.updated_at;
END;
$$;
--------------DOWN
DROP FUNCTION organization.fn_tag_create;
