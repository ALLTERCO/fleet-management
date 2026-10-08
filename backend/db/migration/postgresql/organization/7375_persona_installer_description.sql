--------------UP
-- 7339 let the installer place devices into groups and locations, but the
-- seeded description still promised read-only layout access. The description
-- is what every persona picker renders, so it follows the grant. The personas
-- trigger bumps authz_version. Idempotent + re-runnable.
UPDATE organization.personas
   SET description = 'Field installer: device CRUD + admit/deny waiting room + place devices into groups and locations.'
 WHERE tenant_id IS NULL
   AND is_system_managed = true
   AND key = 'installer';

--------------DOWN
-- Restore the pre-7339 wording.
UPDATE organization.personas
   SET description = 'Field installer: device CRUD + admit/deny waiting room + read across the fleet layout.'
 WHERE tenant_id IS NULL
   AND is_system_managed = true
   AND key = 'installer';
