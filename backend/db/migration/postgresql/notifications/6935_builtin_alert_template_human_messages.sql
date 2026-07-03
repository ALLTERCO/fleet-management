--------------UP
-- Built-ins are Fleet-owned defaults. Keep org-authored templates untouched,
-- but refresh the built-in wording on upgrade so clients get the newest copy.
UPDATE notifications.alert_rule_templates
   SET summary_template = '{{alert.title}}',
       message_template = '{{alert.message}}'
 WHERE organization_id IS NULL
   AND template_key LIKE 'builtin:%';

--------------DOWN
UPDATE notifications.alert_rule_templates t
   SET summary_template = v.summary_template,
       message_template = v.message_template
  FROM (VALUES
    ('builtin:device_offline_5min', 'Device {{device.name}} went offline', '{{device.name}} ({{device.shellyID}}) has been offline for over 5 minutes.'),
    ('builtin:device_offline_30min', 'CRITICAL: {{device.name}} offline > 30 min', '{{device.name}} ({{device.shellyID}}) has been offline for over 30 minutes.'),
    ('builtin:device_offline_immediate', 'CRITICAL: {{device.name}} dropped offline', '{{device.name}} ({{device.shellyID}}) went offline.'),
    ('builtin:device_back_online', '{{device.name}} is back online', '{{device.name}} ({{device.shellyID}}) is reporting again.'),
    ('builtin:battery_below_20', 'Battery low on {{device.name}}', '{{device.name}} battery is below 20%. Plan a swap soon.'),
    ('builtin:battery_below_5', 'CRITICAL: battery < 5% on {{device.name}}', '{{device.name}} battery is below 5%. Recharge now.'),
    ('builtin:smoke_alarm_any', 'SMOKE ALARM at {{device.name}}', 'A smoke detector at {{device.name}} ({{device.shellyID}}) is in alarm.'),
    ('builtin:flood_alarm_any', 'FLOOD detected at {{device.name}}', 'A water sensor at {{device.name}} ({{device.shellyID}}) detected flooding.'),
    ('builtin:motion_detected', 'Motion at {{device.name}}', 'Motion or presence detected at {{device.name}} ({{device.shellyID}}).'),
    ('builtin:motion_restricted_area', 'INTRUSION: motion at {{device.name}}', 'Motion detected in a restricted area: {{device.name}}.'),
    ('builtin:temp_above_30c', 'High temperature at {{device.name}}', '{{device.name}} ({{device.shellyID}}) reported temperature above 30 C.'),
    ('builtin:temp_below_5c_freezer', 'Cold-chain break at {{device.name}}', '{{device.name}} ({{device.shellyID}}) dropped below the 5 C freezer floor.'),
    ('builtin:humidity_above_70', 'High humidity at {{device.name}}', '{{device.name}} ({{device.shellyID}}) reported humidity above 70%.'),
    ('builtin:pressure_above_1050hpa', 'High pressure at {{device.name}}', '{{device.name}} ({{device.shellyID}}) reported pressure above 1050 hPa.'),
    ('builtin:co2_above_1000ppm', 'High CO2 at {{device.name}}', '{{device.name}} ({{device.shellyID}}) reported CO2 above 1000 ppm.'),
    ('builtin:tvoc_above_500', 'High TVOC at {{device.name}}', '{{device.name}} ({{device.shellyID}}) reported TVOC above 500.'),
    ('builtin:power_above_2kw', 'High power draw on {{device.name}}', '{{device.name}} ({{device.shellyID}}) reported active power above 2000 W.'),
    ('builtin:switch_power_above_1kw', 'High switch power on {{device.name}}', '{{device.name}} ({{device.shellyID}}) reported switch power above 1000 W.'),
    ('builtin:voltage_above_250', 'Overvoltage at {{device.name}}', '{{device.name}} ({{device.shellyID}}) reported voltage above 250 V.'),
    ('builtin:consumption_above_5kwh_1h', 'High hourly consumption at {{device.name}}', '{{device.name}} consumed more than 5 kWh in the last hour.'),
    ('builtin:consumption_above_20kwh_24h', 'High daily consumption at {{device.name}}', '{{device.name}} consumed more than 20 kWh in the last 24 hours.'),
    ('builtin:relay_on', '{{device.name}} relay on', 'Relay {{component}} on {{device.name}} is in the ON state.'),
    ('builtin:relay_off', '{{device.name}} relay off', 'Relay {{component}} on {{device.name}} is in the OFF state.'),
    ('builtin:cover_open', '{{device.name}} cover opened', 'Cover {{component}} on {{device.name}} reports open.'),
    ('builtin:cover_closed', '{{device.name}} cover closed', 'Cover {{component}} on {{device.name}} reports closed.'),
    ('builtin:door_open', '{{device.name}} opened', 'Door/window {{device.name}} reports open.'),
    ('builtin:door_open_held_5min', '{{device.name}} left open', 'Door/window {{device.name}} has stayed open for 5 minutes.'),
    ('builtin:door_closed', '{{device.name}} closed', 'Door/window {{device.name}} reports closed.'),
    ('builtin:presence_detected', 'Presence at {{device.name}}', '{{device.name}} reports presence.'),
    ('builtin:occupancy_detected', 'Occupancy at {{device.name}}', '{{device.name}} reports occupancy.'),
    ('builtin:carbon_monoxide_detected', 'CARBON MONOXIDE at {{device.name}}', 'Carbon monoxide sensor {{device.name}} is in alarm.'),
    ('builtin:gas_detected', 'GAS alarm at {{device.name}}', 'Gas sensor {{device.name}} is in alarm.'),
    ('builtin:tamper_detected', 'Tamper at {{device.name}}', '{{device.name}} reports tamper.'),
    ('builtin:vibration_detected', 'Vibration at {{device.name}}', '{{device.name}} reports vibration.'),
    ('builtin:garage_door_open', 'Garage door open at {{device.name}}', '{{device.name}} reports garage door open.'),
    ('builtin:lock_unlocked', 'Lock unlocked at {{device.name}}', '{{device.name}} reports unlocked.'),
    ('builtin:sound_detected', 'Sound at {{device.name}}', '{{device.name}} reports sound.'),
    ('builtin:firmware_failed', 'Firmware update failed on {{device.name}}', 'A firmware operation on {{device.name}} ({{device.shellyID}}) failed.'),
    ('builtin:backup_failed', 'Backup failed for {{device.name}}', 'A configuration backup for {{device.name}} ({{device.shellyID}}) failed.'),
    ('builtin:automation_failed', 'Automation failed: {{device.name}}', 'An automation run on {{device.name}} ({{device.shellyID}}) failed.')
  ) AS v(template_key, summary_template, message_template)
 WHERE t.organization_id IS NULL
   AND t.template_key = v.template_key;
