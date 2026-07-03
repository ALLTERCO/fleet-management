--------------UP
-- Grant `grafana:read` to the managerial-tier system personas so they can
-- reach the FM-proxied Grafana UI. Admins pass via `group='admin'` and do
-- not need an explicit grant. Viewer / auditor / operator / installer get
-- no Grafana access by default — operators must grant explicitly.

UPDATE organization.personas
   SET statements = jsonb_set(
           jsonb_set(
               statements,
               '{0,actions}',
               (statements->0->'actions') || '["grafana:read"]'::jsonb
           ),
           '{0,resource_types}',
           (statements->0->'resource_types') || '["grafana"]'::jsonb
       ),
       version = version + 1,
       updated_at = now()
 WHERE tenant_id IS NULL
   AND is_system_managed = true
   AND key IN ('manager', 'editor', 'automation_admin')
   AND NOT (statements->0->'actions' ? 'grafana:read');

--------------DOWN
UPDATE organization.personas
   SET statements = jsonb_set(
           jsonb_set(
               statements,
               '{0,actions}',
               (
                   SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
                     FROM jsonb_array_elements(statements->0->'actions') value
                    WHERE value::text <> '"grafana:read"'
               )
           ),
           '{0,resource_types}',
           (
               SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
                 FROM jsonb_array_elements(statements->0->'resource_types') value
                WHERE value::text <> '"grafana"'
           )
       ),
       version = version + 1,
       updated_at = now()
 WHERE tenant_id IS NULL
   AND is_system_managed = true
   AND key IN ('manager', 'editor', 'automation_admin')
   AND statements->0->'actions' ? 'grafana:read';
