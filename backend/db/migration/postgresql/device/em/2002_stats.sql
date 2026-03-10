--------------UP
SELECT remove_retention_policy('device_em.stats');
SELECT add_retention_policy('device_em.stats', INTERVAL '1 year');
--------------DOWN
SELECT remove_retention_policy('device_em.stats');
SELECT add_retention_policy('device_em.stats', INTERVAL '3 months');
