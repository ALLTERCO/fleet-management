--------------UP
-- Automation Admin: allows administering automation surfaces such as the
-- standalone Node-RED editor without granting general identity/auth admin.

INSERT INTO organization.personas
    (key, name, description, statements, tenant_id, is_system_managed)
VALUES
    ('automation_admin',
     'Automation Admin',
     'Can manage automation runtimes and read the fleet context needed to build flows.',
     '[{"actions":["automation:read","automation:update","automation:execute","automation:*","device:read","action:read","group:read","dashboard:read","location:read","tag:read","organization:read","alert:read","notification:read","integration:read"],"resource_types":["automation","device","action","group","dashboard","location","tag","organization","alert","notification","integration"],"effect":"Allow"}]'::jsonb,
     NULL,
     true)
ON CONFLICT (key) WHERE tenant_id IS NULL
DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    statements = EXCLUDED.statements,
    version = organization.personas.version + 1,
    updated_at = now();

--------------DOWN
DELETE FROM organization.personas
 WHERE tenant_id IS NULL AND is_system_managed = true
   AND key = 'automation_admin';
