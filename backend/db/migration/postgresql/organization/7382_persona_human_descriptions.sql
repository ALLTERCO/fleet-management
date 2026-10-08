--------------UP
-- Persona descriptions are customer-facing help text returned by persona.list.
UPDATE organization.personas
   SET description = CASE key
       WHEN 'admin' THEN 'Full access to settings, users, devices and operations.'
       WHEN 'manager' THEN 'Manage day-to-day operations, devices and content. Cannot manage users or access permissions.'
       WHEN 'editor' THEN 'View and update existing operational information. Cannot create or delete items.'
       WHEN 'installer' THEN 'Set up devices, approve new devices, and place them in groups and locations.'
       WHEN 'operator' THEN 'Monitor and control devices, acknowledge alerts, and run automations.'
       WHEN 'automation_admin' THEN 'Create, manage and run automations, with read-only access to the fleet information they use.'
       WHEN 'auditor' THEN 'Review fleet information and the access audit log without making changes.'
       WHEN 'viewer' THEN 'View fleet information without making changes.'
       ELSE description
   END
 WHERE tenant_id IS NULL
   AND is_system_managed = true
   AND key IN ('admin', 'manager', 'editor', 'installer', 'operator', 'automation_admin', 'auditor', 'viewer');

--------------DOWN
UPDATE organization.personas
   SET description = CASE key
       WHEN 'admin' THEN 'Full administrative access'
       WHEN 'manager' THEN 'Editor + create + delete + device control. No identity/auth admin powers.'
       WHEN 'editor' THEN 'Viewer + update on operational resources. Cannot create or delete.'
       WHEN 'installer' THEN 'Field installer: device CRUD + admit/deny waiting room + place devices into groups and locations.'
       WHEN 'operator' THEN 'Day-to-day device control: device read+write + alert ack + run automations + read inbox.'
       WHEN 'automation_admin' THEN 'Can manage automation runtimes and read the fleet context needed to build flows.'
       WHEN 'auditor' THEN 'Read across every readable resource + audit log. Compliance / review role.'
       WHEN 'viewer' THEN 'Read-only across every readable resource. Safe default observer role.'
       ELSE description
   END
 WHERE tenant_id IS NULL
   AND is_system_managed = true
   AND key IN ('admin', 'manager', 'editor', 'installer', 'operator', 'automation_admin', 'auditor', 'viewer');
