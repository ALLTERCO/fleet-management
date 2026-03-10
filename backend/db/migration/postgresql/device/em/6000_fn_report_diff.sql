--------------UP
CREATE FUNCTION device_em.fn_report_diff(
    p_devices INTEGER[],
    p_from TIMESTAMP WITH TIME ZONE,
    p_to TIMESTAMP WITH TIME ZONE,
    p_period device_em.t_period
)
    RETURNS table (
        device INTEGER,
        start_date timestamp with time zone,
        end_date timestamp with time zone,
        record_date VARCHAR(12),
        total_energy_kw REAL,
        rn BIGINT
    )
AS
$$
DECLARE _period VARCHAR;
BEGIN
    IF p_period = 'year' THEN _period := 'YYYY';
    ELSIF p_period = 'month' THEN _period := 'YYYY-MM';
    ELSIF p_period = 'day' THEN _period := 'YYYY-MM-DD';
    ELSE _period := 'YYYY-MM';
    END IF;
    RETURN QUERY (
        SELECT
            s.device,
            MIN(s.ts) start_date,
            MAX(s.ts) end_date,
            CAST(to_char(CAST(s.ts AS DATE), _period) AS VARCHAR) record_date,
            CAST(ROUND((SUM(s.val) / 1000)::numeric, 3) AS REAL) total_energy_kw,
            ROW_NUMBER () OVER (ORDER BY s.device, to_char(CAST(s.ts AS DATE), _period)) rn
        FROM device_em.mv__total_energy_24_h s
        WHERE
            1 = 1
            AND (p_devices IS NULL OR s.device = ANY(p_devices))
            AND s.ts >= p_from
            AND s.ts <= p_to
        GROUP BY
            s.device,
            to_char(CAST(s.ts AS DATE), _period)
        ORDER BY
            s.device,
            to_char(CAST(s.ts AS DATE), _period) ASC
    );
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION device_em.fn_report_diff;