--------------UP
-- Reusable email templates — operators save subject/html/text bodies once
-- and reference them by id on one or many email_smtp endpoints.

CREATE TABLE notifications.email_templates (
    id               SERIAL       PRIMARY KEY,
    organization_id  VARCHAR(120) NOT NULL REFERENCES organization.profile(id) ON DELETE CASCADE,
    name             VARCHAR(200) NOT NULL,
    description      TEXT,
    subject_template VARCHAR(998),
    html_template    TEXT,
    text_template    TEXT,
    -- JSON array of {filename, url, cid?, contentType?}. Nodemailer fetches
    -- the url at send time — keep this trimmed to small logos / headers.
    attachments      JSONB        NOT NULL DEFAULT '[]'::jsonb,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ,

    CONSTRAINT email_templates_name_nonempty CHECK (length(trim(name)) > 0),
    CONSTRAINT email_templates_html_len      CHECK (html_template    IS NULL OR length(html_template)    <= 32000),
    CONSTRAINT email_templates_text_len      CHECK (text_template    IS NULL OR length(text_template)    <= 8000),
    CONSTRAINT email_templates_subject_len   CHECK (subject_template IS NULL OR length(subject_template) <= 998),
    CONSTRAINT email_templates_any_body      CHECK (
        subject_template IS NOT NULL OR html_template IS NOT NULL OR text_template IS NOT NULL
    ),
    CONSTRAINT email_templates_attachments_is_array CHECK (jsonb_typeof(attachments) = 'array')
);

CREATE UNIQUE INDEX email_templates_name_by_org
    ON notifications.email_templates (organization_id, LOWER(name));
CREATE INDEX email_templates_by_org
    ON notifications.email_templates (organization_id, created_at DESC);

--------------DOWN
DROP INDEX IF EXISTS notifications.email_templates_by_org;
DROP INDEX IF EXISTS notifications.email_templates_name_by_org;
DROP TABLE IF EXISTS notifications.email_templates;
