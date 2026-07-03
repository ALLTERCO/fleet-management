--------------UP
-- Starter templates for the entity_state watcher (relay/door/cover state).
-- Callers supply scope + recipient (a single channel by default, a group
-- optionally) and may override the component/field for their device.
-- Idempotent via ON CONFLICT.
INSERT INTO notifications.alert_rule_templates (
    template_key, category, label, description,
    kind, severity,
    config, dedupe_window_sec, cooldown_sec,
    summary_template, message_template, auto_resolve
) VALUES
    ('relay-turned-on', 'state',
     'Relay turned on',
     'Notify when a switch output turns on. Adjust the component for the channel (switch:0, switch:1, …).',
     'entity_state', 'info',
     '{"component":"switch:0","field":"output","equals":true}'::jsonb, 0, 0,
     NULL, NULL, TRUE),

    ('relay-turned-off', 'state',
     'Relay turned off',
     'Notify when a switch output turns off.',
     'entity_state', 'info',
     '{"component":"switch:0","field":"output","equals":false}'::jsonb, 0, 0,
     NULL, NULL, TRUE),

    ('cover-opened', 'state',
     'Door/Cover opened',
     'Notify when a cover (door/window/garage) reports open. For BLU door/window sensors, point component at entity:<id> and field at open.',
     'entity_state', 'warning',
     '{"component":"cover:0","field":"state","equals":"open"}'::jsonb, 0, 0,
     NULL, NULL, TRUE),

    ('cover-closed', 'state',
     'Door/Cover closed',
     'Informational notice when a cover reports closed.',
     'entity_state', 'info',
     '{"component":"cover:0","field":"state","equals":"closed"}'::jsonb, 0, 0,
     NULL, NULL, TRUE)
-- Built-in templates have organization_id = NULL; match the org-scoped unique
-- index from migration 6532 (COALESCE(organization_id,''), template_key).
ON CONFLICT (COALESCE(organization_id, ''), template_key) DO NOTHING;

--------------DOWN
DELETE FROM notifications.alert_rule_templates
WHERE template_key IN (
    'relay-turned-on',
    'relay-turned-off',
    'cover-opened',
    'cover-closed'
);
