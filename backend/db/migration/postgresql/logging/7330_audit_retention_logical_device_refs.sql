--------------UP
CREATE OR REPLACE FUNCTION logging.fn_logical_device_audit_retention_days(
    p_organization_id VARCHAR,
    p_device_id INTEGER,
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
          FROM organization.group_members gm
          JOIN organization.groups g
            ON g.id = gm.group_id
           AND g.organization_id = gm.organization_id
         WHERE gm.organization_id = p_organization_id
           AND gm.device_id = p_device_id
           AND gm.subject_type = 'device'
      ) resolved
     WHERE resolved.days IS NOT NULL;
$$;

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
    SELECT logging.fn_logical_device_audit_retention_days(
               d.organization_id,
               d.id,
               p_default_standard,
               p_default_operational,
               p_default_critical,
               p_default_custom
           )
      FROM device.list d
     WHERE d.external_id = p_shelly_id;
$$;

CREATE OR REPLACE FUNCTION logging.fn_sweep_audit(
    p_fallback_days INTEGER DEFAULT 90,
    p_default_standard INTEGER DEFAULT NULL,
    p_default_operational INTEGER DEFAULT NULL,
    p_default_critical INTEGER DEFAULT NULL,
    p_default_custom INTEGER DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted BIGINT;
    v_min_days INTEGER;
BEGIN
    SELECT LEAST(
        p_fallback_days,
        p_default_standard, p_default_operational,
        p_default_critical, p_default_custom,
        (SELECT MIN((g.metadata->'policy'->>'auditRetentionDays')::INTEGER)
           FROM organization.groups g
          WHERE g.metadata->'policy'->>'auditRetentionDays' ~ '^[0-9]+$')
    ) INTO v_min_days;
    v_min_days := COALESCE(v_min_days, p_fallback_days);

    WITH per_row AS (
        SELECT a.id,
               a.ts,
               COALESCE(
                   (
                       SELECT MAX(
                           logging.fn_logical_device_audit_retention_days(
                               a.organization_id,
                               ref.device_id,
                               p_default_standard,
                               p_default_operational,
                               p_default_critical,
                               p_default_custom
                           )
                       )
                         FROM (
                             SELECT a.device_id
                              WHERE a.device_id IS NOT NULL
                             UNION
                             SELECT unnest(a.device_ids)
                              WHERE a.device_ids IS NOT NULL
                         ) ref
                   ),
                   logging.fn_org_audit_retention_days(
                       a.organization_id,
                       p_default_standard,
                       p_default_operational,
                       p_default_critical,
                       p_default_custom
                   ),
                   p_fallback_days
               ) AS days
          FROM logging.audit_log a
         WHERE a.ts < NOW() - (v_min_days || ' days')::INTERVAL
    ), deleted AS (
        DELETE FROM logging.audit_log a
        USING per_row pr
         WHERE a.id = pr.id
           AND a.ts = pr.ts
           AND a.ts < NOW() - (pr.days || ' days')::INTERVAL
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
END;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION logging.fn_sweep_audit(
    p_fallback_days INTEGER DEFAULT 90,
    p_default_standard INTEGER DEFAULT NULL,
    p_default_operational INTEGER DEFAULT NULL,
    p_default_critical INTEGER DEFAULT NULL,
    p_default_custom INTEGER DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted BIGINT;
    v_min_days INTEGER;
BEGIN
    SELECT LEAST(
        p_fallback_days,
        p_default_standard, p_default_operational,
        p_default_critical, p_default_custom,
        (SELECT MIN((g.metadata->'policy'->>'auditRetentionDays')::INTEGER)
           FROM organization.groups g
          WHERE g.metadata->'policy'->>'auditRetentionDays' ~ '^[0-9]+$')
    ) INTO v_min_days;
    v_min_days := COALESCE(v_min_days, p_fallback_days);

    WITH per_row AS (
        SELECT a.id,
               a.ts,
               COALESCE(
                   (
                       SELECT MAX(
                           logging.fn_device_audit_retention_days(
                               sid,
                               p_default_standard,
                               p_default_operational,
                               p_default_critical,
                               p_default_custom
                           )
                       )
                         FROM (
                             SELECT a.shelly_id AS sid
                              WHERE a.shelly_id IS NOT NULL
                             UNION
                             SELECT unnest(a.shelly_ids) AS sid
                              WHERE a.shelly_ids IS NOT NULL
                         ) devices
                   ),
                   logging.fn_org_audit_retention_days(
                       a.organization_id,
                       p_default_standard,
                       p_default_operational,
                       p_default_critical,
                       p_default_custom
                   ),
                   p_fallback_days
               ) AS days
          FROM logging.audit_log a
         WHERE a.ts < NOW() - (v_min_days || ' days')::INTERVAL
    ), deleted AS (
        DELETE FROM logging.audit_log a
        USING per_row pr
         WHERE a.id = pr.id
           AND a.ts = pr.ts
           AND a.ts < NOW() - (pr.days || ' days')::INTERVAL
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
END;
$$;

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

DROP FUNCTION IF EXISTS logging.fn_logical_device_audit_retention_days(
    VARCHAR, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER
);
