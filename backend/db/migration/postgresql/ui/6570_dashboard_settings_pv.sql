--------------UP
-- PV configuration per dashboard: mode + which meters are grid vs generation.
-- Refs are [{device, channel}] (channel null = whole device).
SET search_path TO ui, public;
ALTER TABLE ui.dashboard_settings ADD COLUMN IF NOT EXISTS pv_mode VARCHAR(16);
ALTER TABLE ui.dashboard_settings ADD COLUMN IF NOT EXISTS pv_grid_refs JSONB;
ALTER TABLE ui.dashboard_settings ADD COLUMN IF NOT EXISTS pv_generation_refs JSONB;

CREATE OR REPLACE FUNCTION ui.fn_dashboard_settings_set_pv(
    p_dashboard_id       INT,
    p_pv_mode            VARCHAR(16),
    p_pv_grid_refs       JSONB,
    p_pv_generation_refs JSONB
)
RETURNS VOID
LANGUAGE sql AS $$
    UPDATE ui.dashboard_settings
       SET pv_mode = p_pv_mode,
           pv_grid_refs = p_pv_grid_refs,
           pv_generation_refs = p_pv_generation_refs,
           updated = CURRENT_TIMESTAMP
     WHERE dashboard_id = p_dashboard_id;
$$;

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
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_set_pv(INT, VARCHAR(16), JSONB, JSONB);
ALTER TABLE ui.dashboard_settings DROP COLUMN IF EXISTS pv_mode;
ALTER TABLE ui.dashboard_settings DROP COLUMN IF EXISTS pv_grid_refs;
ALTER TABLE ui.dashboard_settings DROP COLUMN IF EXISTS pv_generation_refs;

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
