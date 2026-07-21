--------------UP
CREATE OR REPLACE FUNCTION logging.fn_device_audit_retention_days(
    p_shelly_id VARCHAR,
    p_default_standard INTEGER DEFAULT NULL,
    p_default_operational INTEGER DEFAULT NULL,
    p_default_critical INTEGER DEFAULT NULL,
    p_default_custom INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT MAX(resolved.days)
      FROM (
        SELECT COALESCE(
            CASE
                WHEN g.metadata->'policy'->>'auditRetentionDays' ~ '^[0-9]+$'
                THEN (g.metadata->'policy'->>'auditRetentionDays')::INTEGER
            END,
            (
                SELECT CASE
                    WHEN p.value ~ '^[0-9]+$' THEN p.value::INTEGER
                END
                  FROM organization.group_type_policy p
                 WHERE p.group_type = g.group_type
                   AND p.field_key = 'audit_retention_days'
            ),
            CASE g.group_type
                WHEN 'standard' THEN p_default_standard
                WHEN 'operational' THEN p_default_operational
                WHEN 'critical' THEN p_default_critical
                WHEN 'custom' THEN p_default_custom
            END
        ) AS days
          FROM device.list d
          JOIN organization.group_members gm
            ON gm.organization_id = d.organization_id
           AND gm.device_id = d.id
           AND gm.subject_type = 'device'
          JOIN organization.groups g
            ON g.id = gm.group_id
           AND g.organization_id = gm.organization_id
         WHERE d.external_id = p_shelly_id
      ) resolved
     WHERE resolved.days IS NOT NULL;
$$;

--------------DOWN
-- Forward-only logical identity migration.
