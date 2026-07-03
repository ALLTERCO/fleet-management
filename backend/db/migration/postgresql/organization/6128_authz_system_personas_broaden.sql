--------------UP
-- Broaden seeded viewer + installer personas to grant reads across all
-- read-relevant resources, matching the legacy VIEWER_PERMISSIONS /
-- INSTALLER_PERMISSIONS contract. Idempotent.

UPDATE organization.personas
   SET statements = '[
       {"actions":["device:read","group:read","dashboard:read","location:read","tag:read","action:read","alert:read","notification:read","integration:read","report:read","configuration:read"],
        "resource_types":["device","group","dashboard","location","tag","action","alert","notification","integration","report","configuration"],
        "effect":"Allow"}
   ]'::jsonb
 WHERE tenant_id IS NULL
   AND key = 'viewer'
   AND is_system_managed = true;

UPDATE organization.personas
   SET statements = '[
       {"actions":["device:read","device:write","waiting_room:read","waiting_room:create","waiting_room:delete","group:read","dashboard:read","location:read","tag:read","action:read","alert:read","notification:read","integration:read","report:read","configuration:read"],
        "resource_types":["device","waiting_room","group","dashboard","location","tag","action","alert","notification","integration","report","configuration"],
        "effect":"Allow"}
   ]'::jsonb
 WHERE tenant_id IS NULL
   AND key = 'installer'
   AND is_system_managed = true;

--------------DOWN
-- Re-apply the narrower 6117 seed.
UPDATE organization.personas
   SET statements =
       '[{"actions":["device:read"],"resource_types":["device"],"effect":"Allow"}]'::jsonb
 WHERE tenant_id IS NULL
   AND key = 'viewer'
   AND is_system_managed = true;

UPDATE organization.personas
   SET statements =
       '[{"actions":["device:read","waiting_room:create","waiting_room:delete"],"resource_types":["device","waiting_room"],"effect":"Allow"}]'::jsonb
 WHERE tenant_id IS NULL
   AND key = 'installer'
   AND is_system_managed = true;
