--------------UP
-- Peak-power device selection: which devices count toward the peak figure.
-- null = all devices in scope.
SET search_path TO ui, public;
ALTER TABLE ui.dashboard_settings ADD COLUMN IF NOT EXISTS peak_device_ids JSONB;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_settings_set_peak_devices(
    p_dashboard_id    INT,
    p_peak_device_ids JSONB
)
RETURNS VOID
LANGUAGE sql AS $$
    UPDATE ui.dashboard_settings
       SET peak_device_ids = p_peak_device_ids, updated = CURRENT_TIMESTAMP
     WHERE dashboard_id = p_dashboard_id;
$$;

-- Extend fn_dashboard_settings_fetch to include peak_device_ids.
-- RETURNS TABLE shape changes require DROP + recreate.
DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_fetch(INT);

CREATE OR REPLACE FUNCTION ui.fn_dashboard_settings_fetch(
    p_dashboard_id INT
)
RETURNS TABLE (
    id INT,
    dashboard_id INT,
    tariff DECIMAL(10,4),
    currency VARCHAR(10),
    default_range VARCHAR(20),
    refresh_interval INT,
    enabled_metrics JSONB,
    chart_settings JSONB,
    tariff_mode VARCHAR(20),
    day_rate DECIMAL(10,4),
    night_rate DECIMAL(10,4),
    day_start TIME,
    day_end TIME,
    tariff_id INT,
    peak_device_ids JSONB
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id, s.dashboard_id, s.tariff, s.currency,
        s.default_range, s.refresh_interval,
        s.enabled_metrics, s.chart_settings,
        s.tariff_mode, s.day_rate, s.night_rate,
        s.day_start, s.day_end,
        s.tariff_id,
        s.peak_device_ids
    FROM ui.dashboard_settings s
    WHERE s.dashboard_id = p_dashboard_id;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_set_peak_devices(INT, JSONB);
ALTER TABLE ui.dashboard_settings DROP COLUMN IF EXISTS peak_device_ids;

-- Restore fn_dashboard_settings_fetch without peak_device_ids.
DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_fetch(INT);

CREATE OR REPLACE FUNCTION ui.fn_dashboard_settings_fetch(
    p_dashboard_id INT
)
RETURNS TABLE (
    id INT,
    dashboard_id INT,
    tariff DECIMAL(10,4),
    currency VARCHAR(10),
    default_range VARCHAR(20),
    refresh_interval INT,
    enabled_metrics JSONB,
    chart_settings JSONB,
    tariff_mode VARCHAR(20),
    day_rate DECIMAL(10,4),
    night_rate DECIMAL(10,4),
    day_start TIME,
    day_end TIME,
    tariff_id INT
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id, s.dashboard_id, s.tariff, s.currency,
        s.default_range, s.refresh_interval,
        s.enabled_metrics, s.chart_settings,
        s.tariff_mode, s.day_rate, s.night_rate,
        s.day_start, s.day_end,
        s.tariff_id
    FROM ui.dashboard_settings s
    WHERE s.dashboard_id = p_dashboard_id;
END;
$$;
