--------------UP
CREATE INDEX IF NOT EXISTS device_em__stats_device_ts
    ON device_em.stats (device, ts DESC);

--------------DOWN
DROP INDEX IF EXISTS device_em.device_em__stats_device_ts;
