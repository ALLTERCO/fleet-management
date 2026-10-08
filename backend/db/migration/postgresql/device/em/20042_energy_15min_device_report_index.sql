-- energy_15min is read by device. Its only general index leads with bucket.
--
-- The writer's key is UNIQUE (bucket, device, tag, domain, phase, channel).
-- Reads ask `device = ANY() AND bucket BETWEEN AND tag = ANY()`, so a
-- bucket-leading index walks the whole fleet's range and filters after.
--
-- Measured, 25 devices, one tag, seven days, eight rows out:
--   before  19,562ms in the index, Index Searches: 1
--   after       769ms,              Index Searches: 25
--   warm         40ms
--
-- Stats were tested and ruled out: ANALYZE on a 14.5M-row hypertable with no
-- stats gave an identical plan and no speedup. The index is the whole fix.
--
-- 20037 already added this exact shape for batteries only. This is it without
-- the WHERE, and 20037's index is dropped: same columns, narrower predicate, so
-- it answers nothing this one cannot. Two definitions of one access path is a
-- duplicate that costs disk and slows every write.
--
-- Build takes 168s on 8.9M rows and holds a write lock. Schedule it in prod.
--------------UP
SET search_path TO device_em, public;

CREATE INDEX IF NOT EXISTS energy_15min_device_report_idx
    ON device_em.energy_15min (device, tag, bucket DESC);

DROP INDEX IF EXISTS device_em.energy_15min_battery_report_idx;

--------------DOWN
CREATE INDEX IF NOT EXISTS energy_15min_battery_report_idx
    ON device_em.energy_15min (device, tag, bucket DESC)
    WHERE electrical_source = 'dc_battery'
      AND tag IN ('soc', 'soh', 'cycles', 'charge_ah', 'discharge_ah');

DROP INDEX IF EXISTS device_em.energy_15min_device_report_idx;
