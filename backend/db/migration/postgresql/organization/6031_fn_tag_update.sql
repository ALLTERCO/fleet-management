--------------UP
-- Partial update; key is immutable (spec §8.4 Tag.Update phase-1 lock).
CREATE OR REPLACE FUNCTION organization.fn_tag_update(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_name            VARCHAR DEFAULT NULL,
    p_description     VARCHAR DEFAULT NULL,
    p_clear_description BOOLEAN DEFAULT FALSE,
    p_color           VARCHAR DEFAULT NULL,
    p_clear_color     BOOLEAN DEFAULT FALSE,
    p_icon            VARCHAR DEFAULT NULL,
    p_clear_icon      BOOLEAN DEFAULT FALSE,
    p_metadata        JSONB   DEFAULT NULL
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
    UPDATE organization.tags SET
        name        = COALESCE(p_name, tags.name),
        description = CASE
            WHEN p_clear_description THEN NULL
            WHEN p_description IS NOT NULL THEN p_description
            ELSE tags.description
        END,
        color       = CASE
            WHEN p_clear_color THEN NULL
            WHEN p_color IS NOT NULL THEN p_color
            ELSE tags.color
        END,
        icon        = CASE
            WHEN p_clear_icon THEN NULL
            WHEN p_icon IS NOT NULL THEN p_icon
            ELSE tags.icon
        END,
        metadata    = COALESCE(p_metadata, tags.metadata),
        updated_at  = NOW()
    WHERE tags.id = p_id AND tags.organization_id = p_organization_id
    RETURNING tags.id, tags.organization_id, tags.key, tags.name,
              tags.description, tags.color, tags.icon, tags.metadata,
              tags.created_at, tags.updated_at;
$$;
--------------DOWN
DROP FUNCTION organization.fn_tag_update;
