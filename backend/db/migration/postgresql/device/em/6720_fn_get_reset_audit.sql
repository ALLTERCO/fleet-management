--------------UP
-- Surfaces per-(device, channel, tag) reset history for the
-- Energy.GetResetAudit RPC. Filters to rows whose reset_count > 0
-- (devices that have NEVER reset don't need to clutter the
-- diagnostics view) and optionally to a window (last_reset_ts within
-- p_window_days) so the operator can find "noisy this week" devices.

CREATE OR REPLACE FUNCTION device_em.fn_get_reset_audit(
    p_window_days INT DEFAULT NULL,
    p_device INT DEFAULT NULL
)
RETURNS TABLE (
    device         INT,
    channel        SMALLINT,
    tag            VARCHAR(30),
    reset_count    INT,
    last_reset_ts  TIMESTAMP WITH TIME ZONE,
    last_seen_ts   TIMESTAMP WITH TIME ZONE
)
AS $$
    SELECT
        l.device,
        l.channel,
        l.tag,
        l.reset_count,
        l.last_reset_ts,
        l.last_seen_ts
    FROM device_em.lifetime_counters l
    WHERE l.reset_count > 0
      AND (p_device IS NULL OR l.device = p_device)
      AND (
          p_window_days IS NULL
          OR l.last_reset_ts > now() - (p_window_days || ' days')::INTERVAL
      )
    ORDER BY l.reset_count DESC, l.last_reset_ts DESC;
$$
LANGUAGE sql;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_get_reset_audit(INT, INT);
