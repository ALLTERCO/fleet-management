--------------UP
-- Market-based emission factor for GHG Protocol Scope 2 dual-reporting.
-- LBM is grid-mix (already added in 6561); MBM accounts for green PPAs / RECs.
ALTER TABLE ui.dashboard_settings
    ADD COLUMN IF NOT EXISTS emission_factor_mbm_g_per_kwh DOUBLE PRECISION;

COMMENT ON COLUMN ui.dashboard_settings.emission_factor_mbm_g_per_kwh
    IS 'Market-based emission factor (g CO₂e/kWh). NULL = MBM section omitted from carbon report. Used alongside emission_factor_g_per_kwh per GHG Protocol Scope 2 Guidance.';
--------------DOWN
ALTER TABLE ui.dashboard_settings
    DROP COLUMN IF EXISTS emission_factor_mbm_g_per_kwh;
