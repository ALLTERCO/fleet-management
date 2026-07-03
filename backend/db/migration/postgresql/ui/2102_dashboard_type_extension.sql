--------------UP
-- 1. Extend dashboard_type CHECK constraint to include new dashboard types
ALTER TABLE ui.dashboard
    DROP CONSTRAINT IF EXISTS dashboard_dashboard_type_check;

ALTER TABLE ui.dashboard
    ADD CONSTRAINT dashboard_dashboard_type_check
    CHECK (dashboard_type IN ('classic', 'analytics', 'overview', 'energy', 'environment', 'control', 'safety'));

-- 2. Add day/night tariff fields to dashboard_settings
ALTER TABLE ui.dashboard_settings
    ADD COLUMN IF NOT EXISTS tariff_mode VARCHAR(20) DEFAULT 'single'
        CHECK (tariff_mode IN ('single', 'day_night')),
    ADD COLUMN IF NOT EXISTS day_rate DECIMAL(10,4) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS night_rate DECIMAL(10,4) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS day_start TIME DEFAULT '07:00:00',
    ADD COLUMN IF NOT EXISTS day_end TIME DEFAULT '23:00:00';

-- Comments for documentation
COMMENT ON COLUMN ui.dashboard_settings.tariff_mode IS 'Tariff mode: single rate or day/night split rates';
COMMENT ON COLUMN ui.dashboard_settings.day_rate IS 'Price per kWh during daytime hours';
COMMENT ON COLUMN ui.dashboard_settings.night_rate IS 'Price per kWh during nighttime hours';
COMMENT ON COLUMN ui.dashboard_settings.day_start IS 'Start of daytime period for day/night tariff';
COMMENT ON COLUMN ui.dashboard_settings.day_end IS 'End of daytime period for day/night tariff';
--------------DOWN
ALTER TABLE ui.dashboard_settings
    DROP COLUMN IF EXISTS tariff_mode,
    DROP COLUMN IF EXISTS day_rate,
    DROP COLUMN IF EXISTS night_rate,
    DROP COLUMN IF EXISTS day_start,
    DROP COLUMN IF EXISTS day_end;

ALTER TABLE ui.dashboard
    DROP CONSTRAINT IF EXISTS dashboard_dashboard_type_check;

-- WARNING: Rollback will fail if rows with dashboard_type in
-- ('overview','energy','environment','control','safety') exist.
-- Delete or reclassify those rows first before running this rollback.
ALTER TABLE ui.dashboard
    ADD CONSTRAINT dashboard_dashboard_type_check
    CHECK (dashboard_type IN ('classic', 'analytics'));
