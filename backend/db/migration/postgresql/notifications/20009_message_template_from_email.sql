--------------UP
-- Migrate the legacy email_templates library into the unified
-- message_template table and repoint every endpoint that referenced one.
-- Attachments are intentionally dropped. A provenance column records the
-- source row so this migration is reversible.

ALTER TABLE notifications.message_template
    ADD COLUMN IF NOT EXISTS migrated_from_email_template_id INTEGER;

-- subject/html/text -> bodies.email; fallback_text (required) synthesized from
-- the most human body available. Skip rows already migrated (idempotent).
INSERT INTO notifications.message_template
    (organization_id, name, description, bodies, fallback_text,
     created_at, updated_at, migrated_from_email_template_id)
SELECT
    et.organization_id,
    et.name,
    et.description,
    CASE
        WHEN COALESCE(et.subject_template, '') <> ''
          OR COALESCE(et.html_template, '') <> ''
          OR COALESCE(et.text_template, '') <> ''
        THEN jsonb_build_object('email', jsonb_build_object(
                'subject', COALESCE(et.subject_template, ''),
                'html', COALESCE(et.html_template, ''),
                'text', COALESCE(et.text_template, '')))
        ELSE '{}'::jsonb
    END,
    LEFT(COALESCE(
        NULLIF(et.text_template, ''),
        NULLIF(et.subject_template, ''),
        et.name,
        'Notification'
    ), 16000),
    et.created_at,
    et.updated_at,
    et.id
FROM notifications.email_templates et
WHERE NOT EXISTS (
    SELECT 1 FROM notifications.message_template mt
    WHERE mt.migrated_from_email_template_id = et.id
);

-- Repoint endpoints: config.emailTemplateId -> config.templateId (new id).
UPDATE notifications.integration_endpoints e
SET config = (e.config - 'emailTemplateId')
             || jsonb_build_object('templateId', mt.id),
    updated_at = NOW()
FROM notifications.message_template mt
WHERE e.config ? 'emailTemplateId'
  AND mt.organization_id = e.organization_id
  AND mt.migrated_from_email_template_id = (e.config->>'emailTemplateId')::int;

-- Block deleting a template still referenced by a rule or an endpoint.
CREATE OR REPLACE FUNCTION notifications.fn_message_template_delete(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (deleted_id INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM notifications.alert_rules
        WHERE organization_id = p_organization_id AND template_id = p_id
    ) OR EXISTS (
        SELECT 1 FROM notifications.integration_endpoints
        WHERE organization_id = p_organization_id
          AND (config->>'templateId')::int = p_id
    ) THEN
        RAISE EXCEPTION 'message_template % is still in use', p_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN QUERY
    DELETE FROM notifications.message_template
    WHERE id = p_id AND organization_id = p_organization_id
    RETURNING id AS deleted_id;
END;
$$;

--------------DOWN
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

UPDATE notifications.integration_endpoints e
SET config = (e.config - 'templateId')
             || jsonb_build_object('emailTemplateId',
                                   mt.migrated_from_email_template_id),
    updated_at = NOW()
FROM notifications.message_template mt
WHERE e.config ? 'templateId'
  AND mt.organization_id = e.organization_id
  AND mt.id = (e.config->>'templateId')::int
  AND mt.migrated_from_email_template_id IS NOT NULL;

DELETE FROM notifications.message_template
WHERE migrated_from_email_template_id IS NOT NULL;

ALTER TABLE notifications.message_template
    DROP COLUMN IF EXISTS migrated_from_email_template_id;
