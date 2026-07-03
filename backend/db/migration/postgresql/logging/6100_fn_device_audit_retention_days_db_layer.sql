--------------UP
-- Policy B (audit): resolver now checks organization.group_type_policy
-- between per-group override and env-param fallback. No signature change.
CREATE OR REPLACE FUNCTION logging.fn_device_audit_retention_days(
    p_shelly_id VARCHAR,
    p_default_standard    INTEGER DEFAULT NULL,
    p_default_operational INTEGER DEFAULT NULL,
    p_default_critical    INTEGER DEFAULT NULL,
    p_default_custom      INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT MAX(resolved.days)
    FROM (
        SELECT COALESCE(
            (g.metadata->'policy'->>'auditRetentionDays')::INTEGER,
            (SELECT p.value::INTEGER FROM organization.group_type_policy p
              WHERE p.group_type = g.group_type
                AND p.field_key  = 'audit_retention_days'),
            CASE g.group_type
                WHEN 'standard'    THEN p_default_standard
                WHEN 'operational' THEN p_default_operational
                WHEN 'critical'    THEN p_default_critical
                WHEN 'custom'      THEN p_default_custom
            END
        ) AS days
        FROM organization.groups g
        JOIN organization.group_members gm
          ON gm.group_id = g.id
         AND gm.organization_id = g.organization_id
         AND gm.subject_type = 'device'
         AND gm.subject_id = p_shelly_id
    ) AS resolved
    WHERE resolved.days IS NOT NULL;
$$;
--------------DOWN
-- Previous version exists as 6004; nothing to restore explicitly.
