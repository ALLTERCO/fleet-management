--------------UP
-- Starter catalog. Templates carry default kind/severity/config/throttling;
-- callers supply scope + destination groups + (optional) override config
-- when instantiating. ON CONFLICT keeps the seed idempotent on re-run.
INSERT INTO notifications.alert_rule_templates (
    template_key, category, label, description,
    kind, severity,
    config, dedupe_window_sec, cooldown_sec,
    summary_template, message_template, auto_resolve
) VALUES
    ('device-offline-critical', 'device-health',
     'Device offline (critical)',
     'Fire when the device has been offline for 5 minutes or more.',
     'device_offline', 'critical',
     '{"offlineForSec":300}'::jsonb, 60, 0,
     NULL, NULL, TRUE),

    ('device-back-online', 'device-health',
     'Device back online',
     'Informational notice when a previously-offline device reconnects.',
     'device_back_online', 'info',
     '{}'::jsonb, 0, 0,
     NULL, NULL, TRUE),

    ('battery-low-warning', 'battery',
     'Battery low (warning)',
     'Warn when battery drops below 20%.',
     'battery_below', 'warning',
     '{"thresholdPct":20}'::jsonb, 3600, 0,
     NULL, NULL, TRUE),

    ('battery-critical', 'battery',
     'Battery critical',
     'Escalate when battery drops below 10%.',
     'battery_below', 'critical',
     '{"thresholdPct":10}'::jsonb, 3600, 0,
     NULL, NULL, TRUE),

    ('smoke-alarm', 'safety',
     'Smoke alarm',
     'Critical alert whenever a smoke sensor reports alarm.',
     'smoke_alarm', 'critical',
     '{}'::jsonb, 0, 0,
     NULL, NULL, TRUE),

    ('flood-alarm', 'safety',
     'Flood alarm',
     'Critical alert whenever a flood sensor reports alarm.',
     'flood_alarm', 'critical',
     '{}'::jsonb, 0, 0,
     NULL, NULL, TRUE),

    ('motion-detected', 'motion',
     'Motion detected',
     'Informational notice on motion events with a 5-minute auto-clear.',
     'motion_detected', 'info',
     '{"clearTimeoutSec":300}'::jsonb, 0, 0,
     NULL, NULL, TRUE),

    ('firmware-update-failed', 'operations',
     'Firmware update failed',
     'Warn when a firmware job completes with an error.',
     'firmware_operation_failed', 'warning',
     '{}'::jsonb, 0, 0,
     NULL, NULL, FALSE),

    ('backup-failed', 'operations',
     'Backup failed',
     'Warn when a scheduled backup run fails.',
     'backup_operation_failed', 'warning',
     '{}'::jsonb, 0, 0,
     NULL, NULL, FALSE),

    ('automation-run-failed', 'operations',
     'Automation run failed',
     'Warn when an automation execution fails.',
     'automation_run_failed', 'warning',
     '{}'::jsonb, 0, 0,
     NULL, NULL, FALSE)
ON CONFLICT (template_key) DO NOTHING;
--------------DOWN
DELETE FROM notifications.alert_rule_templates WHERE template_key IN (
    'device-offline-critical',
    'device-back-online',
    'battery-low-warning',
    'battery-critical',
    'smoke-alarm',
    'flood-alarm',
    'motion-detected',
    'firmware-update-failed',
    'backup-failed',
    'automation-run-failed'
);
