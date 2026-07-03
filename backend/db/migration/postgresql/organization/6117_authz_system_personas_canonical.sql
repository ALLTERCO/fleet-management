--------------UP
-- Self-healing canonical statements for system personas. Idempotent.

UPDATE organization.personas
   SET statements =
       '[{"actions":["*"],"resource_types":["*"],"effect":"Allow"}]'::jsonb
 WHERE tenant_id IS NULL
   AND key = 'admin'
   AND is_system_managed = true;

UPDATE organization.personas
   SET statements =
       '[{"actions":["device:read","waiting_room:create","waiting_room:delete"],"resource_types":["device","waiting_room"],"effect":"Allow"}]'::jsonb
 WHERE tenant_id IS NULL
   AND key = 'installer'
   AND is_system_managed = true;

UPDATE organization.personas
   SET statements =
       '[{"actions":["device:read"],"resource_types":["device"],"effect":"Allow"}]'::jsonb
 WHERE tenant_id IS NULL
   AND key = 'viewer'
   AND is_system_managed = true;

UPDATE organization.personas
   SET statements =
       '[{"actions":["device:read","device:write"],"resource_types":["device"],"effect":"Allow"}]'::jsonb
 WHERE tenant_id IS NULL
   AND key = 'operator'
   AND is_system_managed = true;

--------------DOWN
-- No-op: idempotent self-healing backfill. Re-applying the seed statements
-- is safe; "rolling back" to non-canonical statements has no defined target.
