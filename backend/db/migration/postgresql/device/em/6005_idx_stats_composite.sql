--------------UP
-- Composite index for fn_report_stats / fn_report_stats_by_phase.
--
-- These functions filter by (device, tag, ts range) — the existing single-
-- column `device` index from 2001_stats.sql forces a chunk-level scan for
-- every fetched device. The composite index (device, tag, ts DESC) lets
-- Postgres seek directly to the (device, tag) slice and walk the btree
-- in ts order, dramatically reducing the read set for Energy.Query.
--
-- Chosen over (device, ts, tag) because the WHERE clause is equality on
-- device + tag (both ANY(...)) and range on ts — the tag-equality predicate
-- produces a narrower subtree than the ts range does.
CREATE INDEX IF NOT EXISTS device_em__stats_device_tag_ts
    ON device_em.stats
    USING btree (device, tag, ts DESC);
--------------DOWN
DROP INDEX IF EXISTS device_em__stats_device_tag_ts;
