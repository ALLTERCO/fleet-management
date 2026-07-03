--------------UP
-- Batched cursor read for EM sync: one call returns MAX(created) per
-- (device, channel) for a set of devices, replacing the per-device +
-- per-channel fn_last_sync round-trips on the sync hot path. This collapses
-- dozens of concurrent DB connections per cycle into a single query.
CREATE OR REPLACE FUNCTION device_em.fn_last_sync_batch(
    p_devices INT[]
)
    RETURNS TABLE (device INT, channel INT, created BIGINT)
AS
$$
    SELECT s.device, s.channel, MAX(s.created) AS created
      FROM device_em.sync AS s
     WHERE s.device = ANY(p_devices)
     GROUP BY s.device, s.channel;
$$
LANGUAGE sql STABLE;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_last_sync_batch(INT[]);
