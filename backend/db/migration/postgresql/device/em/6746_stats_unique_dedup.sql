--------------UP
-- Non-unique covering index on device_em.stats (device, tag, phase, channel,
-- ts). Created NON-UNIQUE on purpose: TimescaleDB refuses a UNIQUE index on a
-- hypertable that already has compressed chunks, so the original UNIQUE form of
-- this migration broke the upgrade for every long-running tenant (stats
-- compresses after 7 days) with "operation not supported on hypertables that
-- have compression enabled". A non-unique index is added to a compressed
-- hypertable with no decompression — now and on every future upgrade.
--
-- NOTE: an earlier revision used this index to back a cross-table NOT EXISTS
-- dedup probe in fn_append_stats (6747). That probe was removed (see 6747) — it
-- could not prune chunks and was fatally slow under ingestion. The index is
-- retained as a read-support index: report queries filter device_em.stats by
-- device / tag / phase / channel over a time range, which this index covers.
--
-- Tenants that already applied the prior UNIQUE form skip this by name and keep
-- their unique index, which serves the same read paths.
SET search_path TO device_em, public;
CREATE INDEX IF NOT EXISTS device_em__stats_dedup ON device_em.stats (device, tag, phase, channel, ts);
--------------DOWN
DROP INDEX IF EXISTS device_em.device_em__stats_dedup;
