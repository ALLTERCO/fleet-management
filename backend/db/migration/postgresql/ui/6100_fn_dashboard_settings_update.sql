--------------UP
CREATE OR REPLACE FUNCTION ui.fn_dashboard_settings_update(
    p_dashboard_id      INT,
    p_tariff            DECIMAL(10,4)  DEFAULT NULL,
    p_currency          VARCHAR(10)    DEFAULT NULL,
    p_default_range     VARCHAR(20)    DEFAULT NULL,
    p_refresh_interval  INT            DEFAULT NULL,
    p_enabled_metrics   JSONB          DEFAULT NULL,
    p_chart_settings    JSONB          DEFAULT NULL,
    p_tariff_mode       VARCHAR(20)    DEFAULT NULL,
    p_day_rate          DECIMAL(10,4)  DEFAULT NULL,
    p_night_rate        DECIMAL(10,4)  DEFAULT NULL,
    p_day_start         TIME           DEFAULT NULL,
    p_day_end           TIME           DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO ui.dashboard_settings (dashboard_id, tariff, currency, default_range,
        refresh_interval, enabled_metrics, chart_settings,
        tariff_mode, day_rate, night_rate, day_start, day_end)
    VALUES (
        p_dashboard_id,
        COALESCE(p_tariff, 0.0),
        COALESCE(p_currency, 'EUR'),
        COALESCE(p_default_range, 'last_7_days'),
        COALESCE(p_refresh_interval, 60000),
        COALESCE(p_enabled_metrics, '["uptime","voltage","current","power","consumption","returned_energy","temperature","humidity","luminance"]'::jsonb),
        COALESCE(p_chart_settings, '{}'::jsonb),
        COALESCE(p_tariff_mode, 'single'),
        p_day_rate,
        p_night_rate,
        COALESCE(p_day_start, '07:00:00'),
        COALESCE(p_day_end, '23:00:00')
    )
    ON CONFLICT (dashboard_id) DO UPDATE SET
        tariff           = COALESCE(p_tariff,           ui.dashboard_settings.tariff),
        currency         = COALESCE(p_currency,         ui.dashboard_settings.currency),
        default_range    = COALESCE(p_default_range,    ui.dashboard_settings.default_range),
        refresh_interval = COALESCE(p_refresh_interval, ui.dashboard_settings.refresh_interval),
        enabled_metrics  = COALESCE(p_enabled_metrics,  ui.dashboard_settings.enabled_metrics),
        chart_settings   = COALESCE(p_chart_settings,   ui.dashboard_settings.chart_settings),
        tariff_mode      = COALESCE(p_tariff_mode,      ui.dashboard_settings.tariff_mode),
        day_rate         = p_day_rate,
        night_rate       = p_night_rate,
        day_start        = COALESCE(p_day_start,        ui.dashboard_settings.day_start),
        day_end          = COALESCE(p_day_end,          ui.dashboard_settings.day_end),
        updated          = CURRENT_TIMESTAMP;
END;
$$;
--------------DOWN
-- DROP first; arg list changes (12→7) would leave both overloads live.
DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_update(
    INT, DECIMAL, VARCHAR, VARCHAR, INT, JSONB, JSONB,
    VARCHAR, DECIMAL, DECIMAL, TIME, TIME
);

CREATE OR REPLACE FUNCTION ui.fn_dashboard_settings_update(
    p_dashboard_id INT,
    p_tariff DECIMAL(10,4) DEFAULT NULL,
    p_currency VARCHAR(10) DEFAULT NULL,
    p_default_range VARCHAR(20) DEFAULT NULL,
    p_refresh_interval INT DEFAULT NULL,
    p_enabled_metrics JSONB DEFAULT NULL,
    p_chart_settings JSONB DEFAULT NULL
)
RETURNS VOID
AS
$$
BEGIN
    -- Insert or update (upsert)
    INSERT INTO ui.dashboard_settings (dashboard_id, tariff, currency, default_range, refresh_interval, enabled_metrics, chart_settings)
    VALUES (
        p_dashboard_id,
        COALESCE(p_tariff, 0.0),
        COALESCE(p_currency, 'EUR'),
        COALESCE(p_default_range, 'last_7_days'),
        COALESCE(p_refresh_interval, 60000),
        COALESCE(p_enabled_metrics, '["uptime", "voltage", "current", "power", "consumption", "returned_energy", "temperature", "humidity", "luminance"]'::jsonb),
        COALESCE(p_chart_settings, '{}'::jsonb)
    )
    ON CONFLICT (dashboard_id) DO UPDATE SET
        tariff = COALESCE(p_tariff, ui.dashboard_settings.tariff),
        currency = COALESCE(p_currency, ui.dashboard_settings.currency),
        default_range = COALESCE(p_default_range, ui.dashboard_settings.default_range),
        refresh_interval = COALESCE(p_refresh_interval, ui.dashboard_settings.refresh_interval),
        enabled_metrics = COALESCE(p_enabled_metrics, ui.dashboard_settings.enabled_metrics),
        chart_settings = COALESCE(p_chart_settings, ui.dashboard_settings.chart_settings),
        updated = CURRENT_TIMESTAMP;
END;
$$
LANGUAGE plpgsql;
