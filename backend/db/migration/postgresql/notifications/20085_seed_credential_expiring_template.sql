--------------UP
-- Built-in starter template for the credential_expiring kind (20084), same
-- shape and ON CONFLICT clause as the 20014 built-in catalog seed.

INSERT INTO notifications.alert_rule_templates (
    template_key, category, label, description,
    kind, severity,
    config, dedupe_window_sec, cooldown_sec,
    summary_template, message_template, auto_resolve
) VALUES
    ('builtin:credential_expiring_30d', 'Connectivity',
     'Device key ends in 30 days',
     'Fires once per device whose connection key ends within 30 days. Clears when the key is rotated.',
     'credential_expiring', 'warning',
     '{"daysBefore":30}'::jsonb, 86400, 86400,
     'Key for {{context.shellyID}} ends on {{context.endsAt}}',
     'The key for {{context.shellyID}} ends on {{context.endsAt}}. Rotate it before then.',
     TRUE)
ON CONFLICT (COALESCE(organization_id, ''), template_key) DO NOTHING;

--------------DOWN
DELETE FROM notifications.alert_rule_templates
WHERE organization_id IS NULL
  AND template_key = 'builtin:credential_expiring_30d';
