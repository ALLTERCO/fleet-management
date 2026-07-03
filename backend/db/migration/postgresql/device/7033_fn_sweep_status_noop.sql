--------------UP
-- Neutralize the per-device row-DELETE status sweep.
--
-- fn_sweep_status (migration 6209) ran a bulk row-level DELETE over
-- device.status. device.status is a COMPRESSED hypertable, so that DELETE
-- forces TimescaleDB to decompress chunks and holds table locks for minutes.
-- Those locks block the high-frequency status INSERTs (fn_add / fn_status_push)
-- from connected devices, which pile up and SATURATE the DB connection pool —
-- the root cause of the recurring t9 / t11 connection-saturation outages.
-- Increasing the pool only delays the saturation; the blocking DELETE is the cause.
--
-- Retention is already enforced by the native TimescaleDB drop_chunks policy on
-- device.status (chunk-level, lock-free, does not block live inserts) — the
-- correct retention mechanism for a hypertable. Row-DELETE retention on a
-- compressed hypertable is an anti-pattern. If finer-grained per-device
-- retention is required it must be redesigned to be chunk-compatible, never a
-- row-DELETE on compressed data.
--
-- Make fn_sweep_status a no-op (keep the signature so callers/RetentionScheduler
-- keep working). The native 24h retention policy is already established by
-- 2000_status.sql, so it is not re-added here.
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
BEGIN
    -- No-op. Retention on device.status is enforced by the native
    -- drop_chunks policy_retention (see migration 7033 rationale).
    -- The previous row-DELETE caused decompression + lock storms that
    -- saturated the connection pool.
    RETURN 0;
END;
$$;

--------------DOWN
-- Restore the original per-device row-DELETE sweep from migration 6209.
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
