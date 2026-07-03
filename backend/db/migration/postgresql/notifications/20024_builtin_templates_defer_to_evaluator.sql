--------------UP
-- Single source of truth for built-in template wording: they defer to the
-- evaluator's computed title/message. Runs after the seeds (6932/6935/20014)
-- and normalizes every built-in key. Org-authored templates are untouched.
UPDATE notifications.alert_rule_templates
   SET summary_template = '{{alert.title}}',
       message_template = '{{alert.message}}'
 WHERE organization_id IS NULL
   AND template_key LIKE 'builtin:%'
   AND (summary_template IS DISTINCT FROM '{{alert.title}}'
        OR message_template IS DISTINCT FROM '{{alert.message}}');

--------------DOWN
-- Irreversible: the prior per-key wording was inconsistent, not a target state.
SELECT 1;
