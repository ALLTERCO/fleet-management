--------------UP
-- Per-org retention for device-less audit rows (logins, admin actions). The
-- device path resolves from the device's groups; a row with no device now
-- falls to its own org's group policies before the global fallback, so one
-- org's setting can never trim another org's audit history early.
CREATE OR REPLACE FUNCTION logging.fn_org_audit_retention_days(
    p_organization_id     VARCHAR,
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
        WHERE g.organization_id = p_organization_id
    ) AS resolved
    WHERE resolved.days IS NOT NULL;
$$;

-- Device rows keep using the device resolver; device-less rows fall to the org
-- resolver, then the global fallback. v_min_days is unchanged: the org path
-- draws on the same group metadata and defaults already in its LEAST.
CREATE OR REPLACE FUNCTION logging.fn_sweep_audit(
    p_fallback_days       INTEGER DEFAULT 90,
    p_default_standard    INTEGER DEFAULT NULL,
    p_default_operational INTEGER DEFAULT NULL,
    p_default_critical    INTEGER DEFAULT NULL,
    p_default_custom      INTEGER DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted  BIGINT;
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
        SELECT a.id, a.ts,
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
                           SELECT a.shelly_id AS sid WHERE a.shelly_id IS NOT NULL
                           UNION
                           SELECT unnest(a.shelly_ids) AS sid WHERE a.shelly_ids IS NOT NULL
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
    ),
    deleted AS (
        DELETE FROM logging.audit_log a
        USING per_row pr
        WHERE a.id = pr.id AND a.ts = pr.ts
          AND a.ts < NOW() - (pr.days || ' days')::INTERVAL
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
END;
$$;
--------------DOWN
-- Restore the device-only resolver sweep; device-less rows fall straight to the
-- global fallback again.
CREATE OR REPLACE FUNCTION logging.fn_sweep_audit(
    p_fallback_days       INTEGER DEFAULT 90,
    p_default_standard    INTEGER DEFAULT NULL,
    p_default_operational INTEGER DEFAULT NULL,
    p_default_critical    INTEGER DEFAULT NULL,
    p_default_custom      INTEGER DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted  BIGINT;
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
        SELECT a.id, a.ts,
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
                           SELECT a.shelly_id AS sid WHERE a.shelly_id IS NOT NULL
                           UNION
                           SELECT unnest(a.shelly_ids) AS sid WHERE a.shelly_ids IS NOT NULL
                       ) devices
                   ),
                   p_fallback_days
               ) AS days
        FROM logging.audit_log a
        WHERE a.ts < NOW() - (v_min_days || ' days')::INTERVAL
    ),
    deleted AS (
        DELETE FROM logging.audit_log a
        USING per_row pr
        WHERE a.id = pr.id AND a.ts = pr.ts
          AND a.ts < NOW() - (pr.days || ' days')::INTERVAL
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
END;
$$;

DROP FUNCTION IF EXISTS logging.fn_org_audit_retention_days(
    VARCHAR, INTEGER, INTEGER, INTEGER, INTEGER
);
