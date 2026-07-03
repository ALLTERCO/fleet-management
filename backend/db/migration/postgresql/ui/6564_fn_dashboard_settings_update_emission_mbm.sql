--------------UP
-- Extend fn_dashboard_settings_update with the MBM emission factor.
DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_update(
    INT, DECIMAL, VARCHAR, VARCHAR, INT, JSONB, JSONB,
    VARCHAR, DECIMAL, DECIMAL, TIME, TIME,
    TEXT, JSONB, JSONB, JSONB, DOUBLE PRECISION
);
CREATE FUNCTION ui.fn_dashboard_settings_update(
    p_dashboard_id              INT,
    p_tariff                    DECIMAL(10,4)    DEFAULT NULL,
    p_currency                  VARCHAR(10)      DEFAULT NULL,
    p_default_range             VARCHAR(20)      DEFAULT NULL,
    p_refresh_interval          INT              DEFAULT NULL,
    p_enabled_metrics           JSONB            DEFAULT NULL,
    p_chart_settings            JSONB            DEFAULT NULL,
    p_tariff_mode               VARCHAR(20)      DEFAULT NULL,
    p_day_rate                  DECIMAL(10,4)    DEFAULT NULL,
    p_night_rate                DECIMAL(10,4)    DEFAULT NULL,
    p_day_start                 TIME             DEFAULT NULL,
    p_day_end                   TIME             DEFAULT NULL,
    p_tariff_timezone           TEXT             DEFAULT NULL,
    p_tariff_windows            JSONB            DEFAULT NULL,
    p_tariff_weekend_override   JSONB            DEFAULT NULL,
    p_tariff_holidays           JSONB            DEFAULT NULL,
    p_emission_factor_g_per_kwh DOUBLE PRECISION DEFAULT NULL,
    p_emission_factor_mbm_g_per_kwh DOUBLE PRECISION DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO ui.dashboard_settings (
        dashboard_id, tariff, currency, default_range, refresh_interval,
        enabled_metrics, chart_settings,
        tariff_mode, day_rate, night_rate, day_start, day_end,
        tariff_timezone, tariff_windows, tariff_weekend_override, tariff_holidays,
        emission_factor_g_per_kwh, emission_factor_mbm_g_per_kwh
    )
    VALUES (
        p_dashboard_id,
        COALESCE(p_tariff, 0.0),
        COALESCE(p_currency, 'EUR'),
        COALESCE(p_default_range, 'last_7_days'),
        COALESCE(p_refresh_interval, 60000),
        COALESCE(p_enabled_metrics,
            '["uptime","voltage","current","power","consumption","returned_energy","temperature","humidity","luminance"]'::jsonb),
        COALESCE(p_chart_settings, '{}'::jsonb),
        COALESCE(p_tariff_mode, 'single'),
        p_day_rate,
        p_night_rate,
        COALESCE(p_day_start, '07:00:00'),
        COALESCE(p_day_end, '23:00:00'),
        p_tariff_timezone,
        p_tariff_windows,
        p_tariff_weekend_override,
        p_tariff_holidays,
        p_emission_factor_g_per_kwh,
        p_emission_factor_mbm_g_per_kwh
    )
    ON CONFLICT (dashboard_id) DO UPDATE SET
        tariff                          = COALESCE(p_tariff,                 ui.dashboard_settings.tariff),
        currency                        = COALESCE(p_currency,               ui.dashboard_settings.currency),
        default_range                   = COALESCE(p_default_range,          ui.dashboard_settings.default_range),
        refresh_interval                = COALESCE(p_refresh_interval,       ui.dashboard_settings.refresh_interval),
        enabled_metrics                 = COALESCE(p_enabled_metrics,        ui.dashboard_settings.enabled_metrics),
        chart_settings                  = COALESCE(p_chart_settings,         ui.dashboard_settings.chart_settings),
        tariff_mode                     = COALESCE(p_tariff_mode,            ui.dashboard_settings.tariff_mode),
        day_rate                        = p_day_rate,
        night_rate                      = p_night_rate,
        day_start                       = COALESCE(p_day_start,              ui.dashboard_settings.day_start),
        day_end                         = COALESCE(p_day_end,                ui.dashboard_settings.day_end),
        tariff_timezone                 = COALESCE(p_tariff_timezone,        ui.dashboard_settings.tariff_timezone),
        tariff_windows                  = p_tariff_windows,
        tariff_weekend_override         = p_tariff_weekend_override,
        tariff_holidays                 = p_tariff_holidays,
        emission_factor_g_per_kwh       = COALESCE(p_emission_factor_g_per_kwh,
                                                   ui.dashboard_settings.emission_factor_g_per_kwh),
        emission_factor_mbm_g_per_kwh   = COALESCE(p_emission_factor_mbm_g_per_kwh,
                                                   ui.dashboard_settings.emission_factor_mbm_g_per_kwh),
        updated                         = CURRENT_TIMESTAMP;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_update(
    INT, DECIMAL, VARCHAR, VARCHAR, INT, JSONB, JSONB,
    VARCHAR, DECIMAL, DECIMAL, TIME, TIME,
    TEXT, JSONB, JSONB, JSONB, DOUBLE PRECISION, DOUBLE PRECISION
);
