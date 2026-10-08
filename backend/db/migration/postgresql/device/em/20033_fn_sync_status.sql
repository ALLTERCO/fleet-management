--------------UP
SET search_path TO device_em, public;

CREATE INDEX rollup_dirty_device_channel
    ON device_em.rollup_dirty (device, channel, first_dirty);

CREATE FUNCTION device_em.fn_sync_status(
    p_devices INT[],
    p_channels INT[]
)
RETURNS TABLE (
    device INT,
    channel INT,
    sync_created BIGINT,
    rollup_pending BIGINT,
    oldest_rollup_dirty TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS
$$
    WITH requested AS (
        SELECT DISTINCT u.device, u.channel
        FROM unnest(p_devices, p_channels) AS u(device, channel)
    ),
    sync_latest AS (
        SELECT s.device, s.channel, max(s.created) AS sync_created
        FROM device_em.sync s
        WHERE s.device = ANY(p_devices)
        GROUP BY s.device, s.channel
    ),
    dirty AS (
        SELECT d.device, d.channel,
               count(*)::BIGINT AS rollup_pending,
               min(d.first_dirty) AS oldest_rollup_dirty
        FROM device_em.rollup_dirty d
        WHERE d.device = ANY(p_devices)
        GROUP BY d.device, d.channel
    )
    SELECT
        r.device,
        r.channel,
        s.sync_created,
        COALESCE(d.rollup_pending, 0),
        d.oldest_rollup_dirty
    FROM requested r
    LEFT JOIN sync_latest s
      ON s.device = r.device
     AND s.channel = r.channel
    LEFT JOIN dirty d
      ON d.device = r.device
     AND d.channel IS NOT DISTINCT FROM r.channel
    ORDER BY r.device, r.channel;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_sync_status(INT[], INT[]);
DROP INDEX IF EXISTS device_em.rollup_dirty_device_channel;
