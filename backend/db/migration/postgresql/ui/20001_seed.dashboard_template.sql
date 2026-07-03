--------------UP
-- Seven builtin templates. organization_id = NULL = system-wide.
-- detectsEntityTypes drives entity widget materialization at instantiation.
INSERT INTO ui.dashboard_template
    (organization_id, key, label, description, dashboard_type, seed, is_builtin)
VALUES
    (NULL, 'overview_default', 'Overview',
     'At-a-glance summary of all devices and metrics',
     'overview',
     '{"detectsEntityTypes":["em","em1","pm1","switch","temperature","humidity","flood","smoke","presence"]}'::jsonb,
     TRUE),
    (NULL, 'energy_default', 'Energy',
     'Consumption, cost, and power tracking with period comparison',
     'energy',
     '{"detectsEntityTypes":["em","em1","pm1","em3","switch"]}'::jsonb,
     TRUE),
    (NULL, 'environment_default', 'Environment',
     'Temperature, humidity, and sensor monitoring',
     'environment',
     '{"detectsEntityTypes":["temperature","humidity","flood","smoke"]}'::jsonb,
     TRUE),
    (NULL, 'control_default', 'Control',
     'Operate switches, lights, dimmers, and covers',
     'control',
     '{"detectsEntityTypes":["switch","light","dimmer","cover","rgb","rgbw"]}'::jsonb,
     TRUE),
    (NULL, 'safety_default', 'Safety',
     'Alerts, incidents, and safety sensor status',
     'safety',
     '{"detectsEntityTypes":["flood","smoke","presence"]}'::jsonb,
     TRUE),
    (NULL, 'classic_blank', 'Classic — blank',
     'Empty classic dashboard',
     'classic',
     '{}'::jsonb,
     TRUE),
    (NULL, 'analytics_blank', 'Analytics — blank',
     'Empty analytics dashboard (wizard-driven)',
     'analytics',
     '{}'::jsonb,
     TRUE)
ON CONFLICT (organization_id, key) DO NOTHING;
--------------DOWN
DELETE FROM ui.dashboard_template
 WHERE organization_id IS NULL
   AND key IN ('overview_default','energy_default','environment_default',
               'control_default','safety_default','classic_blank',
               'analytics_blank');
