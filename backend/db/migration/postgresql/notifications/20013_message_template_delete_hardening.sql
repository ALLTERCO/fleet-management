--------------UP
-- Hardens fn_message_template_delete (added in 20009): the in-use guard cast
-- (config->>'templateId')::int throws invalid_text_representation when any
-- endpoint in the org carries a non-numeric templateId, masking the clean
-- "still in use" error. Guard the cast with a numeric match so a malformed
-- config can never crash the delete. Also surfaces endpoints left pointing at
-- a legacy emailTemplateId that 20009 could not repoint (orphaned reference).

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
          AND config->>'templateId' ~ '^[0-9]+$'
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

-- Surface endpoints still carrying a legacy emailTemplateId. After the 20009
-- repoint these are orphans (the referenced email_templates row was gone), so
-- they need manual attention rather than silently rendering with no template.
DO $$
DECLARE
    orphan_count INTEGER;
BEGIN
    SELECT count(*) INTO orphan_count
    FROM notifications.integration_endpoints
    WHERE config ? 'emailTemplateId';
    IF orphan_count > 0 THEN
        RAISE WARNING
            'message_template migration: % endpoint(s) still reference a legacy emailTemplateId with no migrated message_template; manual repoint needed',
            orphan_count;
    END IF;
END $$;

--------------DOWN
-- Restore the 20009 definition (unguarded cast).
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
