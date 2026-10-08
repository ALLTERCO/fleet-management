--------------UP
-- Primary identities keep tied rows on the same page across page sizes.

CREATE OR REPLACE FUNCTION notifications.fn_email_asset_list(
    p_organization_id VARCHAR,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    id           INTEGER,
    filename     VARCHAR,
    content_type VARCHAR,
    size_bytes   INTEGER,
    sha256       CHAR,
    created_at   TIMESTAMPTZ,
    total        BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH base AS (
        SELECT a.id, a.filename, a.content_type, a.size_bytes, a.sha256,
               a.created_at
        FROM notifications.email_assets a
        WHERE a.organization_id = p_organization_id
    ),
    counted AS (
        SELECT COUNT(*)::BIGINT AS n FROM base
    )
    SELECT b.id, b.filename, b.content_type, b.size_bytes, b.sha256,
           b.created_at, (SELECT n FROM counted) AS total
    FROM base b
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0);
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
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0);
END;
$$;

--------------DOWN

CREATE OR REPLACE FUNCTION notifications.fn_email_asset_list(
    p_organization_id VARCHAR,
    p_limit           INTEGER DEFAULT 200,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    id           INTEGER,
    filename     VARCHAR,
    content_type VARCHAR,
    size_bytes   INTEGER,
    sha256       CHAR,
    created_at   TIMESTAMPTZ,
    total        BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH base AS (
        SELECT a.id, a.filename, a.content_type, a.size_bytes, a.sha256,
               a.created_at
        FROM notifications.email_assets a
        WHERE a.organization_id = p_organization_id
    ),
    counted AS (
        SELECT COUNT(*)::BIGINT AS n FROM base
    )
    SELECT b.id, b.filename, b.content_type, b.size_bytes, b.sha256,
           b.created_at, (SELECT n FROM counted) AS total
    FROM base b
    ORDER BY b.created_at DESC
    LIMIT GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0);
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
