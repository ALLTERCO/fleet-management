--------------UP
-- Raw energy becomes a 1-month hot window; long-term history now lives in the
-- 15-minute rollup (device_em.energy_15min), fed live + on emSync backfill.
--
-- RUNBOOK — existing installs with more than ~31 days of raw: run
--   DATABASE_URL=… npx tsx backend/scripts/backfill-energy-15min.ts --apply
-- BEFORE this shrink takes effect, or raw older than 31 days that was not yet
-- rolled up is dropped by the retention job (never expire raw before the rollup
-- is complete). New installs have no old raw, so this is safe automatically.
--
-- Restore `public` so the TimescaleDB retention functions resolve.
SET search_path TO device_em, public;
SELECT remove_retention_policy('device_em.stats', if_exists => TRUE);
SELECT add_retention_policy('device_em.stats', INTERVAL '31 days', if_not_exists => TRUE);
--------------DOWN
SELECT remove_retention_policy('device_em.stats', if_exists => TRUE);
SELECT add_retention_policy('device_em.stats', INTERVAL '1 year', if_not_exists => TRUE);
