--------------UP
-- Every built-in starter delegates its text to the evaluator's alert title and
-- message (20044); the key-expiry starter seeded in 20085 must do the same.
UPDATE notifications.alert_rule_templates
   SET summary_template = '{{alert.title}}',
       message_template = '{{alert.message}}'
 WHERE organization_id IS NULL
   AND template_key = 'builtin:credential_expiring_30d';

--------------DOWN
UPDATE notifications.alert_rule_templates
   SET summary_template = 'Key for {{context.shellyID}} ends on {{context.endsAt}}',
       message_template = 'The key for {{context.shellyID}} ends on {{context.endsAt}}. Rotate it before then.'
 WHERE organization_id IS NULL
   AND template_key = 'builtin:credential_expiring_30d';
