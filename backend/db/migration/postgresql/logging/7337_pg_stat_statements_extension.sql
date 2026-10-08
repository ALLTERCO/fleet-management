--------------UP
-- Create pg_stat_statements per database so the FM /metrics observer can publish
-- per-query DB timing (fm_db_query_* gauges). The library is loaded via
-- shared_preload_libraries in the fleet-db compose command; this creates the
-- queryable view in each tenant DB.
--
-- Tolerant on purpose: if the library is not loaded yet (e.g. an upgrade where
-- the DB has not restarted with the new command), skip with a NOTICE instead of
-- failing the whole migration run. The runtime collector degrades gracefully
-- when the view is absent, and the extension is created cleanly on the next
-- fresh boot once the DB restarts with the library.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_stat_statements unavailable (shared_preload_libraries not loaded yet): %', SQLERRM;
END $$;

--------------DOWN
DROP EXTENSION IF EXISTS pg_stat_statements;
