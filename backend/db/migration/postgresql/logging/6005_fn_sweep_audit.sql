--------------UP
-- Policy B (audit): per-row retention sweep on logging.audit_log.
-- For rows tied to one or more devices (shelly_id scalar OR shelly_ids[]),
-- effective days = MAX across referenced devices. For rows with no device
-- reference, effective days = p_fallback_days (org-wide). Rows older than
-- their effective window are deleted. Returns deleted row count.
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
--------------DOWN
DROP FUNCTION logging.fn_sweep_audit;
