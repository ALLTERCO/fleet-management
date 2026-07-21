--------------UP
-- fn_dashboard_settings_fetch fell behind the table: the carbon (emission
-- factors, CO2 budget) and advanced-tariff (timezone, windows, weekend,
-- holidays) columns are written by fn_dashboard_settings_update but were never
-- added to the fetch signature, so dashboard.GetSettings silently returned
-- defaults for them while the report path read the real values. Add them here.
SET search_path TO ui, public;

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
    peak_device_ids JSONB,
    pv_mode VARCHAR(16),
    pv_grid_refs JSONB,
    pv_generation_refs JSONB,
    tariff_timezone TEXT,
    tariff_windows JSONB,
    tariff_weekend_override JSONB,
    tariff_holidays JSONB,
    emission_factor_g_per_kwh DOUBLE PRECISION,
    emission_factor_mbm_g_per_kwh DOUBLE PRECISION,
    co2_budget_kg DOUBLE PRECISION
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
        s.peak_device_ids,
        s.pv_mode, s.pv_grid_refs, s.pv_generation_refs,
        s.tariff_timezone, s.tariff_windows,
        s.tariff_weekend_override, s.tariff_holidays,
        s.emission_factor_g_per_kwh, s.emission_factor_mbm_g_per_kwh,
        s.co2_budget_kg
    FROM ui.dashboard_settings s
    WHERE s.dashboard_id = p_dashboard_id;
END;
$$;
--------------DOWN
SET search_path TO ui, public;

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
    peak_device_ids JSONB,
    pv_mode VARCHAR(16),
    pv_grid_refs JSONB,
    pv_generation_refs JSONB
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
        s.peak_device_ids,
        s.pv_mode, s.pv_grid_refs, s.pv_generation_refs
    FROM ui.dashboard_settings s
    WHERE s.dashboard_id = p_dashboard_id;
END;
$$;
