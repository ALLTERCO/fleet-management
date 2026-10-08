--------------UP
-- No Shelly component reports occupancy (checked against the Shelly API
-- docs); third-party BTHome occupancy sensors (object 35) do, and the wired
-- Presence sensor is already the presence template's job. Point the
-- occupancy template at the BTHome object like the other BLU-only templates.
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","equals":true,"objName":"occupancy"}'::jsonb,
       description = 'Fires when a BLU occupancy sensor reports occupied.'
 WHERE organization_id IS NULL AND template_key = 'builtin:occupancy_detected';

--------------DOWN
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"occupancy:*","field":"value","equals":true}'::jsonb,
       description = 'Fires when an occupancy sensor reports occupied.'
 WHERE organization_id IS NULL AND template_key = 'builtin:occupancy_detected';
