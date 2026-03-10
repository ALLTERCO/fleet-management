--------------UP
CREATE FUNCTION ui.fn_dashboard_settings_fetch(
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
--------------DOWN
DROP FUNCTION IF EXISTS ui.fn_dashboard_settings_fetch;
