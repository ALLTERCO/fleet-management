--------------UP
-- Resolve per-device retention days from group memberships. Single entry
-- point for Policy B. Returns MAX across groups, or NULL when no group
-- defines a retention policy (caller falls back to the deploy-wide default).
CREATE OR REPLACE FUNCTION device.fn_device_retention_days(
    p_shelly_id VARCHAR,
    p_default_retention_standard    INTEGER DEFAULT NULL,
    p_default_retention_operational INTEGER DEFAULT NULL,
    p_default_retention_critical    INTEGER DEFAULT NULL,
    p_default_retention_custom      INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT MAX(resolved.days)
    FROM (
        SELECT COALESCE(
            (g.metadata->'policy'->>'retentionDays')::INTEGER,
            CASE g.group_type
                WHEN 'standard'    THEN p_default_retention_standard
                WHEN 'operational' THEN p_default_retention_operational
                WHEN 'critical'    THEN p_default_retention_critical
                WHEN 'custom'      THEN p_default_retention_custom
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
DROP FUNCTION device.fn_device_retention_days;
