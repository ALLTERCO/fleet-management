--------------UP
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
    day_end TIME
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id, s.dashboard_id, s.tariff, s.currency,
        s.default_range, s.refresh_interval,
        s.enabled_metrics, s.chart_settings,
        s.tariff_mode, s.day_rate, s.night_rate,
        s.day_start, s.day_end
    FROM ui.dashboard_settings s
    WHERE s.dashboard_id = p_dashboard_id;
END;
$$;
--------------DOWN
-- DROP first; RETURNS TABLE shape changes (13→8 cols) break CREATE OR REPLACE.
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
    chart_settings JSONB
)
AS
$$
BEGIN
    RETURN QUERY (
        SELECT
            ds.id,
            ds.dashboard_id,
            ds.tariff,
            ds.currency,
            ds.default_range,
            ds.refresh_interval,
            ds.enabled_metrics,
            ds.chart_settings
        FROM ui.dashboard_settings ds
        WHERE ds.dashboard_id = p_dashboard_id
    );
END;
$$
LANGUAGE plpgsql;
