--------------UP
-- Make the dedup index UNIQUE and domain-aware so fn_append_stats (6768) can use
-- ON CONFLICT for idempotent ingest. Origin 6746 shipped a non-unique index of
-- the same name; drop it first so the change takes (CREATE ... IF NOT EXISTS
-- would keep the old one). If this fails on a uniqueness violation the install
-- holds duplicate rows: run
--   DATABASE_URL=… npx tsx backend/scripts/dedup-em-stats.ts --apply
-- then re-deploy. Fresh installs have none.
SET search_path TO device_em, public;
DROP INDEX IF EXISTS device_em.device_em__stats_dedup;
CREATE UNIQUE INDEX device_em__stats_dedup
    ON device_em.stats (device, tag, domain, phase, channel, ts) NULLS NOT DISTINCT;
--------------DOWN
-- Restore the origin 6746 non-unique covering index.
DROP INDEX IF EXISTS device_em.device_em__stats_dedup;
CREATE INDEX device_em__stats_dedup
    ON device_em.stats (device, tag, phase, channel, ts);
