--------------UP
-- Guard the retentionDays cast. A non-numeric group metadata value (e.g.
-- "30 days") raised invalid-input and aborted the entire status-retention
-- sweep fleet-wide. Treat a non-integer value as "no policy" and fall through
-- to the group-type default.
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
            CASE
                WHEN g.metadata->'policy'->>'retentionDays' ~ '^[0-9]+$'
                THEN (g.metadata->'policy'->>'retentionDays')::INTEGER
                ELSE NULL
            END,
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
