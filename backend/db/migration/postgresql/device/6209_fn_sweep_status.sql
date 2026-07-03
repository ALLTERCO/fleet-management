--------------UP
-- Per-device status retention sweep. For each device.list row, resolve
-- effective days via fn_device_retention_days; device.status rows older
-- than the resolved window (or p_fallback_days when unresolved) are
-- deleted. Returns deleted row count. Runs alongside TimescaleDB chunk
-- drop; whichever is stricter wins.
CREATE OR REPLACE FUNCTION device.fn_sweep_status(
    p_fallback_days                 INTEGER DEFAULT 7,
    p_default_retention_standard    INTEGER DEFAULT NULL,
    p_default_retention_operational INTEGER DEFAULT NULL,
    p_default_retention_critical    INTEGER DEFAULT NULL,
    p_default_retention_custom      INTEGER DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted BIGINT;
BEGIN
    WITH per_device AS (
        SELECT d.id AS device_id,
               COALESCE(
                   device.fn_device_retention_days(
                       d.external_id,
                       p_default_retention_standard,
                       p_default_retention_operational,
                       p_default_retention_critical,
                       p_default_retention_custom
                   ),
                   p_fallback_days
               ) AS days
        FROM device.list d
        WHERE d.external_id IS NOT NULL
    ),
    deleted AS (
        DELETE FROM device.status s
        USING per_device pd
        WHERE s.id = pd.device_id
          AND s.ts < NOW() - (pd.days || ' days')::INTERVAL
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_deleted FROM deleted;
    RETURN v_deleted;
END;
$$;
--------------DOWN
DROP FUNCTION device.fn_sweep_status;
