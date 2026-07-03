--------------UP
-- CRUD for notifications.email_templates — same shape as other
-- per-org CRUD families (create/update/get/list/delete).

CREATE OR REPLACE FUNCTION notifications.fn_email_template_create(
    p_organization_id  VARCHAR,
    p_name             VARCHAR,
    p_description      TEXT    DEFAULT NULL,
    p_subject_template VARCHAR DEFAULT NULL,
    p_html_template    TEXT    DEFAULT NULL,
    p_text_template    TEXT    DEFAULT NULL,
    p_attachments      JSONB   DEFAULT '[]'::jsonb
)
RETURNS TABLE (
    id               INTEGER,
    organization_id  VARCHAR,
    name             VARCHAR,
    description      TEXT,
    subject_template VARCHAR,
    html_template    TEXT,
    text_template    TEXT,
    attachments      JSONB,
    created_at       TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM organization.fn_profile_ensure(p_organization_id);

    RETURN QUERY
    INSERT INTO notifications.email_templates (
        organization_id, name, description,
        subject_template, html_template, text_template, attachments
    )
    VALUES (
        p_organization_id, p_name, p_description,
        p_subject_template, p_html_template, p_text_template,
        COALESCE(p_attachments, '[]'::jsonb)
    )
    RETURNING
        notifications.email_templates.id,
        notifications.email_templates.organization_id,
        notifications.email_templates.name,
        notifications.email_templates.description,
        notifications.email_templates.subject_template,
        notifications.email_templates.html_template,
        notifications.email_templates.text_template,
        notifications.email_templates.attachments,
        notifications.email_templates.created_at,
        notifications.email_templates.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_email_template_update(
    p_organization_id  VARCHAR,
    p_id               INTEGER,
    p_name             VARCHAR DEFAULT NULL,
    p_description      TEXT    DEFAULT NULL,
    p_subject_template VARCHAR DEFAULT NULL,
    p_html_template    TEXT    DEFAULT NULL,
    p_text_template    TEXT    DEFAULT NULL,
    p_attachments      JSONB   DEFAULT NULL,
    p_clear_description      BOOLEAN DEFAULT FALSE,
    p_clear_subject_template BOOLEAN DEFAULT FALSE,
    p_clear_html_template    BOOLEAN DEFAULT FALSE,
    p_clear_text_template    BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id               INTEGER,
    organization_id  VARCHAR,
    name             VARCHAR,
    description      TEXT,
    subject_template VARCHAR,
    html_template    TEXT,
    text_template    TEXT,
    attachments      JSONB,
    created_at       TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    UPDATE notifications.email_templates t
    SET
        name             = COALESCE(p_name, t.name),
        description      = CASE
            WHEN p_clear_description THEN NULL
            WHEN p_description IS NOT NULL THEN p_description
            ELSE t.description
        END,
        subject_template = CASE
            WHEN p_clear_subject_template THEN NULL
            WHEN p_subject_template IS NOT NULL THEN p_subject_template
            ELSE t.subject_template
        END,
        html_template    = CASE
            WHEN p_clear_html_template THEN NULL
            WHEN p_html_template IS NOT NULL THEN p_html_template
            ELSE t.html_template
        END,
        text_template    = CASE
            WHEN p_clear_text_template THEN NULL
            WHEN p_text_template IS NOT NULL THEN p_text_template
            ELSE t.text_template
        END,
        attachments      = COALESCE(p_attachments, t.attachments),
        updated_at       = NOW()
    WHERE t.id = p_id AND t.organization_id = p_organization_id
    RETURNING
        t.id, t.organization_id, t.name, t.description,
        t.subject_template, t.html_template, t.text_template,
        t.attachments, t.created_at, t.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_email_template_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id               INTEGER,
    organization_id  VARCHAR,
    name             VARCHAR,
    description      TEXT,
    subject_template VARCHAR,
    html_template    TEXT,
    text_template    TEXT,
    attachments      JSONB,
    created_at       TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id, t.organization_id, t.name, t.description,
        t.subject_template, t.html_template, t.text_template,
        t.attachments, t.created_at, t.updated_at
    FROM notifications.email_templates t
    WHERE t.id = p_id AND t.organization_id = p_organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_email_template_list(
    p_organization_id VARCHAR,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    id               INTEGER,
    organization_id  VARCHAR,
    name             VARCHAR,
    description      TEXT,
    subject_template VARCHAR,
    html_template    TEXT,
    text_template    TEXT,
    attachments      JSONB,
    created_at       TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ,
    total            BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH base AS (
        SELECT t.*
        FROM notifications.email_templates t
        WHERE t.organization_id = p_organization_id
    ),
    counted AS (
        SELECT COUNT(*)::BIGINT AS n FROM base
    )
    SELECT
        b.id, b.organization_id, b.name, b.description,
        b.subject_template, b.html_template, b.text_template,
        b.attachments, b.created_at, b.updated_at,
        (SELECT n FROM counted) AS total
    FROM base b
    ORDER BY b.created_at DESC
    LIMIT GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0);
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_email_template_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM notifications.email_templates
    WHERE id = p_id AND organization_id = p_organization_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_email_template_delete(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_email_template_list(VARCHAR, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_email_template_get(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_email_template_update(
    VARCHAR, INTEGER, VARCHAR, TEXT, VARCHAR, TEXT, TEXT, JSONB,
    BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
);
DROP FUNCTION IF EXISTS notifications.fn_email_template_create(
    VARCHAR, VARCHAR, TEXT, VARCHAR, TEXT, TEXT, JSONB
);
