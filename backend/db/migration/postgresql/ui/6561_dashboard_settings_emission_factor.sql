--------------UP
-- Grid emission factor (g CO₂e / kWh) per dashboard. The grid factor is
-- a property of WHERE the electricity is consumed; one number per org is
-- wrong as soon as devices live in multiple regions. Dashboard is the
-- natural carrier because it already scopes by location/group/tag.
ALTER TABLE ui.dashboard_settings
    ADD COLUMN IF NOT EXISTS emission_factor_g_per_kwh DOUBLE PRECISION;

COMMENT ON COLUMN ui.dashboard_settings.emission_factor_g_per_kwh
    IS 'Location-based marginal emission factor in g CO₂e / kWh. NULL falls back to the FM_ENERGY_EMISSION_FACTOR_LBM_G_PER_KWH env tunable. Picked by region — see countryEmissionFactors.ts for reference values.';
--------------DOWN
ALTER TABLE ui.dashboard_settings
    DROP COLUMN IF EXISTS emission_factor_g_per_kwh;
