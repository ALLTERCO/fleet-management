--------------UP
-- Monthly CO₂ budget per dashboard (kg). Report alerts when end-of-period
-- projection would exceed it.
ALTER TABLE ui.dashboard_settings
    ADD COLUMN IF NOT EXISTS co2_budget_kg DOUBLE PRECISION;

COMMENT ON COLUMN ui.dashboard_settings.co2_budget_kg
    IS 'Monthly CO₂e budget in kg. NULL = no budget tracking. Report emits a budget anomaly when projected exceeds.';
--------------DOWN
ALTER TABLE ui.dashboard_settings
    DROP COLUMN IF EXISTS co2_budget_kg;
