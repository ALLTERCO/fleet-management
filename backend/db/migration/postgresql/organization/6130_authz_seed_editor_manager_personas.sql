--------------UP
-- Two more system-managed personas for the Share UX gradient
-- (viewer < editor < manager < admin). Used when an admin shares a single
-- dashboard / device / location with a user at a non-admin role level.
-- Devices stay covered by the existing operator/installer personas.

INSERT INTO organization.personas
    (key, name, description, statements, tenant_id, is_system_managed)
VALUES
    ('editor',
     'Editor',
     'Read + update across most resources. No create/delete.',
     '[{"actions":["dashboard:read","dashboard:update","group:read","group:update","location:read","location:update","tag:read","tag:update","alert:read","alert:update","notification:read","notification:update","integration:read","integration:update","report:read","report:update","configuration:read","configuration:update","device:read"],"resource_types":["dashboard","group","location","tag","alert","notification","integration","report","configuration","device"],"effect":"Allow"}]'::jsonb,
     NULL,
     true),
    ('manager',
     'Manager',
     'Full CRUD across most resources + device control. No admin powers.',
     '[{"actions":["dashboard:read","dashboard:create","dashboard:update","dashboard:delete","group:read","group:create","group:update","group:delete","location:read","location:create","location:update","location:delete","tag:read","tag:create","tag:update","tag:delete","alert:read","alert:create","alert:update","alert:delete","notification:read","notification:create","notification:update","notification:delete","integration:read","integration:create","integration:update","integration:delete","report:read","report:create","report:update","report:delete","configuration:read","configuration:create","configuration:update","configuration:delete","device:read","device:write"],"resource_types":["dashboard","group","location","tag","alert","notification","integration","report","configuration","device"],"effect":"Allow"}]'::jsonb,
     NULL,
     true)
ON CONFLICT DO NOTHING;

--------------DOWN
DELETE FROM organization.personas
 WHERE tenant_id IS NULL
   AND is_system_managed = true
   AND key IN ('editor', 'manager');
