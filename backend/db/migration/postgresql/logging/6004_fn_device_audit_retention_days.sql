--------------UP
-- Policy B (audit): resolve per-device audit retention days from groups.
-- Mirrors device.fn_device_retention_days but reads the `auditRetentionDays`
-- override key and caller-supplied audit-per-type defaults.
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
DROP FUNCTION logging.fn_device_audit_retention_days;
