--------------UP
-- Auditor: read across all 14 V2 resources + read on the authz audit trail.
-- Designed for compliance / SOC 2 / GDPR reviewers who need to inspect
-- actions taken without authority to take any. Distinguished from viewer
-- by the audit-trail read.

INSERT INTO organization.personas
    (key, name, description, statements, tenant_id, is_system_managed)
VALUES
    ('auditor',
     'Auditor',
     'Read across every readable resource + audit log. Compliance / review role.',
     '[{"actions":["device:read","action:read","group:read","dashboard:read","waiting_room:read","configuration:read","plugin:read","report:read","location:read","tag:read","organization:read","alert:read","notification:read","integration:read","authz_audit:read"],"resource_types":["device","action","group","dashboard","waiting_room","configuration","plugin","report","location","tag","organization","alert","notification","integration","authz_audit"],"effect":"Allow"}]'::jsonb,
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
 WHERE tenant_id IS NULL
   AND is_system_managed = true
   AND key = 'auditor';
