--------------UP
-- Bring all 6 system personas to proper coverage across the 14 V2 resource
-- types. Re-runs idempotently via ON CONFLICT DO UPDATE.
--
-- Trust ladder (everything except identity/auth admin):
--   viewer    — read-only across all 14 resources
--   editor    — viewer + update on operational resources
--   manager   — editor + create + delete + device control
--   admin     — wildcard (kept as-is from 6112)
--
-- Domain roles (device fleet operations):
--   installer — devices + waiting_room (admit/deny) + reads everywhere
--   operator  — devices + alert ack + action execute + notifications
--
-- Resources NOT covered by personas (admin-only): identity, branding,
-- privacy, restrictions, domain_policy, notification_policy, login_text,
-- message_text, certificate, credential, mail, mdns, web, audit,
-- authz_audit, persona, user_group, assignment.

INSERT INTO organization.personas
    (key, name, description, statements, tenant_id, is_system_managed)
VALUES
    ('viewer',
     'Viewer',
     'Read-only across every readable resource. Safe default observer role.',
     '[{"actions":["device:read","action:read","group:read","dashboard:read","waiting_room:read","configuration:read","plugin:read","report:read","location:read","tag:read","organization:read","alert:read","notification:read","integration:read"],"resource_types":["device","action","group","dashboard","waiting_room","configuration","plugin","report","location","tag","organization","alert","notification","integration"],"effect":"Allow"}]'::jsonb,
     NULL,
     true),
    ('editor',
     'Editor',
     'Viewer + update on operational resources. Cannot create or delete.',
     '[{"actions":["dashboard:read","dashboard:update","group:read","group:update","location:read","location:update","tag:read","tag:update","action:read","action:update","alert:read","alert:update","notification:read","notification:update","integration:read","integration:update","report:read","report:update","configuration:read","configuration:update","device:read","waiting_room:read","plugin:read","organization:read"],"resource_types":["dashboard","group","location","tag","action","alert","notification","integration","report","configuration","device","waiting_room","plugin","organization"],"effect":"Allow"}]'::jsonb,
     NULL,
     true),
    ('manager',
     'Manager',
     'Editor + create + delete + device control. No identity/auth admin powers.',
     '[{"actions":["dashboard:read","dashboard:create","dashboard:update","dashboard:delete","group:read","group:create","group:update","group:delete","location:read","location:create","location:update","location:delete","tag:read","tag:create","tag:update","tag:delete","action:read","action:create","action:update","action:delete","alert:read","alert:create","alert:update","alert:delete","notification:read","notification:create","notification:update","notification:delete","integration:read","integration:create","integration:update","integration:delete","report:read","report:create","report:update","report:delete","configuration:read","configuration:create","configuration:update","configuration:delete","device:read","device:write","waiting_room:read","waiting_room:create","waiting_room:delete","plugin:read","organization:read"],"resource_types":["dashboard","group","location","tag","action","alert","notification","integration","report","configuration","device","waiting_room","plugin","organization"],"effect":"Allow"}]'::jsonb,
     NULL,
     true),
    ('installer',
     'Installer',
     'Field installer: device CRUD + admit/deny waiting room + read across the fleet layout.',
     '[{"actions":["device:read","device:write","waiting_room:read","waiting_room:create","waiting_room:delete","configuration:read","configuration:update","group:read","dashboard:read","location:read","tag:read","action:read","alert:read","notification:read","integration:read","report:read","plugin:read","organization:read"],"resource_types":["device","waiting_room","configuration","group","dashboard","location","tag","action","alert","notification","integration","report","plugin","organization"],"effect":"Allow"}]'::jsonb,
     NULL,
     true),
    ('operator',
     'Operator',
     'Day-to-day device control: device read+write + alert ack + run automations + read inbox.',
     '[{"actions":["device:read","device:write","alert:read","alert:update","action:read","action:execute","notification:read"],"resource_types":["device","alert","action","notification"],"effect":"Allow"}]'::jsonb,
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
-- Reapply 6112's narrower seed shape via DO UPDATE (the 6128 broaden +
-- 6130 add migrations would re-apply on next up).
UPDATE organization.personas
   SET statements =
       '[{"actions":["device:read"],"resource_types":["device"],"effect":"Allow"}]'::jsonb,
       version = version + 1, updated_at = now()
 WHERE tenant_id IS NULL AND is_system_managed = true AND key = 'viewer';

UPDATE organization.personas
   SET statements =
       '[{"actions":["device:read","waiting_room:create","waiting_room:delete"],"resource_types":["device","waiting_room"],"effect":"Allow"}]'::jsonb,
       version = version + 1, updated_at = now()
 WHERE tenant_id IS NULL AND is_system_managed = true AND key = 'installer';

UPDATE organization.personas
   SET statements =
       '[{"actions":["device:read","device:write"],"resource_types":["device"],"effect":"Allow"}]'::jsonb,
       version = version + 1, updated_at = now()
 WHERE tenant_id IS NULL AND is_system_managed = true AND key = 'operator';

DELETE FROM organization.personas
 WHERE tenant_id IS NULL AND is_system_managed = true
   AND key IN ('editor', 'manager');
