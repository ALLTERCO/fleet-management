--------------UP
-- Audit retention sweep prefilter. The per-row CTE scanned the whole audit
-- hypertable every tick and called fn_device_audit_retention_days per row. No
-- row younger than the smallest configured retention can ever be expired, so
-- prefilter on ts first (uses the ts index) and keep the exact per-row check in
-- the DELETE.
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
    -- Smallest retention any row could have (defaults + any group policy).
    -- LEAST skips NULLs; a non-numeric group value is not a policy.
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
--------------DOWN
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
    v_deleted BIGINT;
BEGIN
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
