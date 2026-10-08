--------------UP
-- Point every built-in template at a component that really exists.
--
-- A gateway exposes each BLU reading as bthomesensor:N and only the BTHome
-- object name says what it is, so a bare "bthomesensor:*" watch let a door
-- page a carbon-monoxide alarm. Templates for BLU-only signals now carry the
-- object name. Wired sensors use a type wildcard so add-on peripherals
-- (temperature:100, humidity:100 from a Sensor Add-On) count too. The wired
-- Presence sensor reports per zone (presencezone:N.value), never presence:N.

-- Safety: one BTHome object each.
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","equals":true,"objName":"carbon_monoxide"}'::jsonb
 WHERE organization_id IS NULL AND template_key = 'builtin:carbon_monoxide_detected';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","equals":true,"objName":"gas"}'::jsonb
 WHERE organization_id IS NULL AND template_key = 'builtin:gas_detected';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","equals":true,"objName":"tamper"}'::jsonb,
       description = 'Fires when a BLU sensor reports tamper.'
 WHERE organization_id IS NULL AND template_key = 'builtin:tamper_detected';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","equals":true,"objName":"vibration"}'::jsonb,
       description = 'Fires when a BLU sensor reports vibration.'
 WHERE organization_id IS NULL AND template_key = 'builtin:vibration_detected';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","equals":true,"objName":"sound"}'::jsonb,
       description = 'Fires when a BLU sensor reports sound.'
 WHERE organization_id IS NULL AND template_key = 'builtin:sound_detected';

-- State: BTHome binary objects. garage_door true = open; lock false = unlocked.
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","equals":true,"objName":"garage_door"}'::jsonb,
       description = 'Fires when a BLU garage door sensor reports open.'
 WHERE organization_id IS NULL AND template_key = 'builtin:garage_door_open';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","equals":false,"objName":"lock"}'::jsonb,
       description = 'Fires when a BLU lock sensor reports unlocked.'
 WHERE organization_id IS NULL AND template_key = 'builtin:lock_unlocked';

-- Presence: the wired Shelly Presence reports per zone; occupancy is the
-- Wall Display occupancy:N.value.
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"presencezone:*","field":"value","equals":true}'::jsonb,
       description = 'Fires when a Shelly Presence zone reports someone present.'
 WHERE organization_id IS NULL AND template_key = 'builtin:presence_detected';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"occupancy:*","field":"value","equals":true}'::jsonb,
       description = 'Fires when an occupancy sensor reports occupied.'
 WHERE organization_id IS NULL AND template_key = 'builtin:occupancy_detected';

-- Environment: wired sensors by type (native and add-on); BLU air sensors
-- by BTHome object.
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"temperature:*","field":"tC","operator":"gt","threshold":30}'::jsonb,
       description = 'Fires when a wired temperature sensor (built-in or add-on) reads above 30 C.'
 WHERE organization_id IS NULL AND template_key = 'builtin:temp_above_30c';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"temperature:*","field":"tC","operator":"lt","threshold":5}'::jsonb,
       description = 'Fires when a wired temperature sensor (built-in or add-on) reads below 5 C.'
 WHERE organization_id IS NULL AND template_key = 'builtin:temp_below_5c_freezer';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"humidity:*","field":"rh","operator":"gt","threshold":70}'::jsonb,
       description = 'Fires when a wired humidity sensor (built-in or add-on) reads above 70%.'
 WHERE organization_id IS NULL AND template_key = 'builtin:humidity_above_70';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","operator":"gt","threshold":1050,"objName":"pressure"}'::jsonb,
       description = 'Fires when a BLU pressure sensor reads above 1050 hPa.'
 WHERE organization_id IS NULL AND template_key = 'builtin:pressure_above_1050hpa';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","operator":"gt","threshold":1000,"objName":"co2"}'::jsonb,
       description = 'Fires when a BLU CO2 sensor reads above 1000 ppm.'
 WHERE organization_id IS NULL AND template_key = 'builtin:co2_above_1000ppm';
UPDATE notifications.alert_rule_templates
   SET config = '{"component":"bthomesensor:*","field":"value","operator":"gt","threshold":500,"objName":"tvoc"}'::jsonb,
       description = 'Fires when a BLU TVOC sensor reads above 500.'
 WHERE organization_id IS NULL AND template_key = 'builtin:tvoc_above_500';

-- BLU temperature and humidity get their own rows: one template holds one
-- config, and a BLU reading lives under bthomesensor:N.value, not temperature:N.tC.
INSERT INTO notifications.alert_rule_templates (
    template_key, category, label, description,
    kind, severity,
    config, dedupe_window_sec, cooldown_sec,
    summary_template, message_template, auto_resolve
) VALUES
    ('builtin:blu_temp_above_30c', 'Environment',
     'BLU temperature above 30 C',
     'Fires when a BLU temperature sensor reads above 30 C.',
     'component_threshold', 'warning',
     '{"component":"bthomesensor:*","field":"value","operator":"gt","threshold":30,"objName":"temperature"}'::jsonb, 300, 1800,
     '{{alert.title}}', '{{alert.message}}', TRUE),
    ('builtin:blu_humidity_above_70', 'Environment',
     'BLU humidity above 70%',
     'Fires when a BLU humidity sensor reads above 70%.',
     'component_threshold', 'info',
     '{"component":"bthomesensor:*","field":"value","operator":"gt","threshold":70,"objName":"humidity"}'::jsonb, 600, 3600,
     '{{alert.title}}', '{{alert.message}}', TRUE)
ON CONFLICT (COALESCE(organization_id, ''), template_key) DO NOTHING;

-- Honest words: the schema floor for offlineForSec is 30 seconds.
UPDATE notifications.alert_rule_templates
   SET label = 'Device offline > 30 seconds',
       description = 'Fires when a device is offline for 30 seconds, the shortest wait allowed.'
 WHERE organization_id IS NULL AND template_key = 'builtin:device_offline_immediate';

-- Nothing in Fleet Manager reports an automation run failure yet; a template
-- that can never fire is a broken promise. Comes back with a producer.
DELETE FROM notifications.alert_rule_templates
 WHERE organization_id IS NULL AND template_key = 'builtin:automation_failed';

--------------DOWN
-- Irreversible: the old targets pointed at components no device reports.
SELECT 1;
