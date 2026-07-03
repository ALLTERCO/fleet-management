--------------UP
-- Tariff schema extension: timezone-aware multi-band TOU support.
-- All new columns are nullable; existing single/day_night rows keep working.
ALTER TABLE ui.dashboard_settings
    ADD COLUMN IF NOT EXISTS tariff_timezone         TEXT  DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS tariff_windows          JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS tariff_weekend_override JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS tariff_holidays         JSONB DEFAULT NULL;

-- Extend the tariff_mode CHECK from {single, day_night} to add 'tou'.
ALTER TABLE ui.dashboard_settings
    DROP CONSTRAINT IF EXISTS dashboard_settings_tariff_mode_check;
ALTER TABLE ui.dashboard_settings
    ADD CONSTRAINT dashboard_settings_tariff_mode_check
        CHECK (tariff_mode IN ('single', 'day_night', 'tou'));

COMMENT ON COLUMN ui.dashboard_settings.tariff_timezone
    IS 'IANA timezone for interpreting day_start/day_end and tariff_windows. Backfilled to UTC; UI nudges the user to set on first edit.';
COMMENT ON COLUMN ui.dashboard_settings.tariff_windows
    IS 'JSONB array of {from, to, rate, label}. Only populated when tariff_mode = tou. Strip-on-persist when mode is single/day_night.';
COMMENT ON COLUMN ui.dashboard_settings.tariff_weekend_override
    IS 'Optional weekend schedule. Same shape as tariff_windows. NULL = same schedule all days.';
COMMENT ON COLUMN ui.dashboard_settings.tariff_holidays
    IS 'Optional ISO-date list; on those days the weekend override applies. NULL = no holiday handling.';
--------------DOWN
ALTER TABLE ui.dashboard_settings
    DROP CONSTRAINT IF EXISTS dashboard_settings_tariff_mode_check;
ALTER TABLE ui.dashboard_settings
    ADD CONSTRAINT dashboard_settings_tariff_mode_check
        CHECK (tariff_mode IN ('single', 'day_night'));
ALTER TABLE ui.dashboard_settings
    DROP COLUMN IF EXISTS tariff_timezone,
    DROP COLUMN IF EXISTS tariff_windows,
    DROP COLUMN IF EXISTS tariff_weekend_override,
    DROP COLUMN IF EXISTS tariff_holidays;
