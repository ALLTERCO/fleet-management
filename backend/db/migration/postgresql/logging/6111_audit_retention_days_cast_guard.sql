--------------UP
-- Guard the auditRetentionDays casts. A non-numeric group metadata value (e.g.
-- "30 days") or policy value raised invalid-input and aborted the entire audit
-- retention sweep fleet-wide. Treat a non-integer as "no policy" and fall
-- through. Sibling of device.fn_device_retention_days (7032).
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
            CASE
                WHEN g.metadata->'policy'->>'auditRetentionDays' ~ '^[0-9]+$'
                THEN (g.metadata->'policy'->>'auditRetentionDays')::INTEGER
                ELSE NULL
            END,
            (SELECT CASE WHEN p.value ~ '^[0-9]+$' THEN p.value::INTEGER ELSE NULL END
               FROM organization.group_type_policy p
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
