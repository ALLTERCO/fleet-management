--------------UP
-- Retire the per-period energy diff functions. They backed only the
-- removed Report.FetchMonthlyReport / Report.FetchCustomRangeReport RPCs;
-- Report.Generate (timeseries/raw) and Energy.Query read fn_report_stats
-- instead. Verified zero callers across backend/src, tests, scripts, and
-- the rest of backend/db/migration.
--
-- fn_report_mount_diff calls fn_report_diff, so drop the caller first.
-- IF EXISTS makes the migration idempotent. DOWN recreates both verbatim.
DROP FUNCTION IF EXISTS device_em.fn_report_mount_diff;
DROP FUNCTION IF EXISTS device_em.fn_report_diff;
--------------DOWN
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

CREATE FUNCTION device_em.fn_report_mount_diff(
    p_devices INTEGER[],
    p_period device_em.t_period,
    p_period_look_back INT,
    p_end_period_day INT
)
    RETURNS table (
        device INTEGER,
        record_date VARCHAR(12),
        total_energy_kw REAL
    )
AS
$$
BEGIN
    CREATE TEMPORARY TABLE main_data (
        device INTEGER,
        start_date timestamp with time zone,
        end_date timestamp with time zone,
        record_date VARCHAR(12),
        total_energy_kw REAL,
        rn BIGINT
    ) ON COMMIT DROP;
    CREATE TEMPORARY TABLE epoch_time (
        start_date TIMESTAMP WITH TIME ZONE,
        end_date TIMESTAMP WITH TIME ZONE
    ) ON COMMIT DROP;

    INSERT INTO epoch_time (
        SELECT *
        FROM device_em.fn_report_period(p_period, p_period_look_back, p_end_period_day)
    );
    INSERT INTO main_data (
        SELECT * FROM device_em.fn_report_diff(
            p_devices,
            (SELECT et.start_date FROM epoch_time et),
            (SELECT et.end_date FROM epoch_time et),
            p_period
        )
    );

    RETURN QUERY (
        SELECT
            t1.device,
            t1.record_date,
            CASE WHEN t2.rn is not NULL THEN t2.total_energy_kw ELSE t1.total_energy_kw end total_energy_kw
        FROM
            main_data t1
        LEFT JOIN
            (
                SELECT t.device, SUM(t.total_energy_kw) total_energy_kw, MAX(t.rn) rn FROM main_data AS t
                group BY t.device
            ) t2
        ON t1.device = t2.device and t1.rn = t2.rn
    );
END;
$$
LANGUAGE plpgsql;
