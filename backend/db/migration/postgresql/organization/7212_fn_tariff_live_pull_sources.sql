--------------UP
-- Return all pull-mode live tariff sources for the periodic fetch scheduler.
CREATE OR REPLACE FUNCTION organization.fn_tariff_live_pull_sources()
RETURNS TABLE(tariff_id INT, provider VARCHAR, provider_config JSONB)
LANGUAGE sql STABLE AS $$
    SELECT tariff_id, provider, provider_config
    FROM   organization.tariff_live_source
    WHERE  mode = 'pull';
$$;
--------------DOWN
DROP FUNCTION IF EXISTS organization.fn_tariff_live_pull_sources();
