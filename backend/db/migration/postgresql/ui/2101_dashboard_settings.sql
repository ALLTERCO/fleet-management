--------------UP
-- Dashboard settings table for analytics dashboards
CREATE TABLE ui.dashboard_settings (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    dashboard_id INTEGER NOT NULL REFERENCES ui.dashboard(id) ON DELETE CASCADE,
    tariff DECIMAL(10,4) DEFAULT 0.0,
    currency VARCHAR(10) DEFAULT 'EUR',
    default_range VARCHAR(20) DEFAULT 'last_7_days',
    refresh_interval INTEGER DEFAULT 60000,
    enabled_metrics JSONB DEFAULT '["uptime", "voltage", "current", "power", "consumption", "returned_energy", "temperature", "humidity", "luminance"]'::jsonb,
    chart_settings JSONB DEFAULT '{}'::jsonb,
    created TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

-- One settings record per dashboard
CREATE UNIQUE INDEX ui_dashboard_settings_dashboard ON ui.dashboard_settings (dashboard_id);

-- Comments for documentation
COMMENT ON TABLE ui.dashboard_settings IS 'Analytics dashboard configuration';
COMMENT ON COLUMN ui.dashboard_settings.tariff IS 'Price per kWh for cost calculations';
COMMENT ON COLUMN ui.dashboard_settings.currency IS 'Currency code (EUR, USD, etc.)';
COMMENT ON COLUMN ui.dashboard_settings.default_range IS 'Default time range: last_24h, last_7_days, last_30_days, custom';
COMMENT ON COLUMN ui.dashboard_settings.refresh_interval IS 'Auto-refresh interval in milliseconds';
COMMENT ON COLUMN ui.dashboard_settings.enabled_metrics IS 'Array of enabled metric types';
COMMENT ON COLUMN ui.dashboard_settings.chart_settings IS 'Per-chart configuration overrides';
--------------DOWN
DROP TABLE IF EXISTS ui.dashboard_settings;
