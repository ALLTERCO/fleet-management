--------------UP
-- Reusable multi-channel alert message templates. One row holds per-channel
-- bodies (email/slack/teams) as JSONB plus a required plain-text fallback used
-- for every other channel or when a channel body is absent. Org-scoped.
CREATE TABLE IF NOT EXISTS notifications.message_template (
    id               SERIAL       PRIMARY KEY,
    organization_id  VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    name             VARCHAR(128) NOT NULL,
    description      TEXT,
    bodies           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    fallback_text    TEXT         NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ,
    CONSTRAINT message_template_name_len CHECK (LENGTH(name) BETWEEN 1 AND 128),
    CONSTRAINT message_template_fallback_len CHECK (LENGTH(fallback_text) BETWEEN 1 AND 16000)
);

CREATE INDEX IF NOT EXISTS message_template_by_org
    ON notifications.message_template (organization_id, name);

CREATE OR REPLACE FUNCTION notifications.fn_message_template_list(
    p_organization_id VARCHAR
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    name            VARCHAR,
    description     TEXT,
    bodies          JSONB,
    fallback_text   TEXT,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT id, organization_id, name, description, bodies, fallback_text,
           created_at, updated_at
    FROM notifications.message_template
    WHERE organization_id = p_organization_id
    ORDER BY name ASC;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_message_template_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    name            VARCHAR,
    description     TEXT,
    bodies          JSONB,
    fallback_text   TEXT,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT id, organization_id, name, description, bodies, fallback_text,
           created_at, updated_at
    FROM notifications.message_template
    WHERE organization_id = p_organization_id AND id = p_id;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_message_template_create(
    p_organization_id VARCHAR,
    p_name            VARCHAR,
    p_description     TEXT,
    p_bodies          JSONB,
    p_fallback_text   TEXT
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    name            VARCHAR,
    description     TEXT,
    bodies          JSONB,
    fallback_text   TEXT,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);
    RETURN QUERY
    INSERT INTO notifications.message_template
        (organization_id, name, description, bodies, fallback_text)
    VALUES
        (p_organization_id, p_name, p_description,
         COALESCE(p_bodies, '{}'::jsonb), p_fallback_text)
    RETURNING message_template.id, message_template.organization_id,
              message_template.name, message_template.description,
              message_template.bodies, message_template.fallback_text,
              message_template.created_at, message_template.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_message_template_update(
    p_organization_id VARCHAR,
    p_id              INTEGER,
    p_name            VARCHAR DEFAULT NULL,
    p_description     TEXT DEFAULT NULL,
    p_clear_description BOOLEAN DEFAULT FALSE,
    p_bodies          JSONB DEFAULT NULL,
    p_fallback_text   TEXT DEFAULT NULL
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    name            VARCHAR,
    description     TEXT,
    bodies          JSONB,
    fallback_text   TEXT,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    UPDATE notifications.message_template t
    SET name = COALESCE(p_name, t.name),
        description = CASE
            WHEN p_clear_description THEN NULL
            WHEN p_description IS NOT NULL THEN p_description
            ELSE t.description
        END,
        bodies = COALESCE(p_bodies, t.bodies),
        fallback_text = COALESCE(p_fallback_text, t.fallback_text),
        updated_at = NOW()
    WHERE t.id = p_id AND t.organization_id = p_organization_id
    RETURNING t.id, t.organization_id, t.name, t.description, t.bodies,
              t.fallback_text, t.created_at, t.updated_at;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_message_template_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (deleted_id INTEGER)
LANGUAGE sql
AS $$
    DELETE FROM notifications.message_template
    WHERE id = p_id AND organization_id = p_organization_id
    RETURNING id AS deleted_id;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_message_template_delete(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_message_template_update(VARCHAR, INTEGER, VARCHAR, TEXT, BOOLEAN, JSONB, TEXT);
DROP FUNCTION IF EXISTS notifications.fn_message_template_create(VARCHAR, VARCHAR, TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS notifications.fn_message_template_get(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_message_template_list(VARCHAR);
DROP TABLE IF EXISTS notifications.message_template;
