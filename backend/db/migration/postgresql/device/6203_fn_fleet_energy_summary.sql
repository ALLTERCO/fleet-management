--------------UP
-- Per-group energy summary for fleet overview cards.
-- Joins device.groups with device.status to aggregate energy and power per group.
CREATE OR REPLACE FUNCTION device.fn_fleet_energy_summary(
    p_from TIMESTAMPTZ,
    p_to   TIMESTAMPTZ
)
RETURNS TABLE (
    group_id      INTEGER,
    total_kwh     NUMERIC,
    avg_power_w   NUMERIC,
    peak_power_w  NUMERIC,
    device_count  INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH group_devices AS (
        -- Resolve each group's device shellyIDs to internal device IDs
        SELECT
            g.id                    AS gid,
            dl.id                   AS dev_id
        FROM device.groups g
        -- unnest the devices TEXT[] array (each element is a shellyID)
        CROSS JOIN LATERAL unnest(g.devices) AS shelly_id
        JOIN device.list dl ON dl.external_id = shelly_id
    ),
    energy AS (
        -- Total energy consumed per device in the window.
        -- Uses last(value, ts) - first(value, ts) which correctly handles the case
        -- where the counter resets mid-window (GREATEST(0,...) floors negative deltas).
        SELECT
            gd.gid,
            gd.dev_id,
            COALESCE(
                GREATEST(0, last(s.value, s.ts) - first(s.value, s.ts)) / 1000.0,
                0
            ) AS kwh
        FROM group_devices gd
        JOIN device.status s
            ON s.id = gd.dev_id
           AND s.ts >= p_from
           AND s.ts <= p_to
           AND (
               s.field_group LIKE 'switch:%.aenergy.total'
               OR s.field_group LIKE 'pm1:%.aenergy.total'
               OR s.field_group LIKE 'em1data:%.total_act_energy'
               OR s.field_group LIKE 'emdata:%.total_act'
           )
        WHERE s.value >= 0
        GROUP BY gd.gid, gd.dev_id, s.field_group, s.field
    ),
    energy_per_group AS (
        SELECT gid, SUM(kwh) AS total_kwh FROM energy GROUP BY gid
    ),
    power AS (
        -- Instantaneous power readings in the window
        SELECT
            gd.gid,
            AVG(s.value)  AS avg_w,
            MAX(s.value)  AS peak_w
        FROM group_devices gd
        JOIN device.status s
            ON s.id = gd.dev_id
           AND s.ts >= p_from
           AND s.ts <= p_to
           AND (
               s.field_group LIKE 'switch:%.apower'
               OR s.field_group LIKE 'pm1:%.apower'
               OR s.field_group LIKE 'em1:%.act_power'
               OR s.field_group LIKE 'em:%.act_power'
           )
        GROUP BY gd.gid
    ),
    device_counts AS (
        SELECT gid, COUNT(DISTINCT dev_id)::INTEGER AS cnt FROM group_devices GROUP BY gid
    )
    SELECT
        g.id                                AS group_id,
        COALESCE(eg.total_kwh, 0)::NUMERIC  AS total_kwh,
        COALESCE(pw.avg_w,     0)::NUMERIC  AS avg_power_w,
        COALESCE(pw.peak_w,    0)::NUMERIC  AS peak_power_w,
        COALESCE(dc.cnt,       0)           AS device_count
    FROM device.groups g
    LEFT JOIN energy_per_group eg ON eg.gid = g.id
    LEFT JOIN power            pw ON pw.gid = g.id
    LEFT JOIN device_counts    dc ON dc.gid = g.id
    ORDER BY g.id;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_fleet_energy_summary(TIMESTAMPTZ, TIMESTAMPTZ);
