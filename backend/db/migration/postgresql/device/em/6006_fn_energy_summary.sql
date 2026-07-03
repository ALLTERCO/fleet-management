--------------UP
-- Per-group energy/power aggregate used by Energy.Summary.
--
-- Replaces the older device.fn_fleet_energy_summary which queried
-- device.status with fragile LIKE patterns that missed cover, light,
-- rgb, and monophase emdata. This version queries device_em.stats
-- directly with the structured `total_act_energy` / `power` tags that
-- every energy-capable device writes uniformly, so the summary no
-- longer drops device types by accident.
--
-- Returns one row per group (zeros when the group has no energy data
-- in the window). Caller filters by p_group_ids if set; passing NULL
-- returns all groups.
CREATE OR REPLACE FUNCTION device_em.fn_energy_summary(
    p_from       TIMESTAMPTZ,
    p_to         TIMESTAMPTZ,
    p_group_ids  INTEGER[] DEFAULT NULL
)
RETURNS TABLE (
    group_id            INTEGER,
    group_name          TEXT,
    total_kwh           NUMERIC,
    returned_kwh        NUMERIC,
    avg_power_w         NUMERIC,
    peak_power_w        NUMERIC,
    device_count        INTEGER,
    total_device_count  INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH group_devices AS (
        -- Resolve each group's device shellyIDs to internal device ids.
        SELECT
            g.id                    AS gid,
            g.name                  AS gname,
            dl.id                   AS dev_id
        FROM device.groups g
        CROSS JOIN LATERAL unnest(g.devices) AS shelly_id
        JOIN device.list dl ON dl.external_id = shelly_id
        WHERE p_group_ids IS NULL OR g.id = ANY(p_group_ids)
    ),
    group_totals AS (
        SELECT
            g.id                 AS gid,
            g.name               AS gname,
            COUNT(DISTINCT gd.dev_id)::INTEGER AS total_devices
        FROM device.groups g
        LEFT JOIN group_devices gd ON gd.gid = g.id
        WHERE p_group_ids IS NULL OR g.id = ANY(p_group_ids)
        GROUP BY g.id, g.name
    ),
    energy AS (
        SELECT
            gd.gid,
            SUM(s.val) / 1000.0 AS total_kwh
        FROM group_devices gd
        JOIN device_em.stats s
          ON s.device = gd.dev_id
         AND s.ts >= p_from
         AND s.ts <  p_to
         AND s.tag = 'total_act_energy'
        GROUP BY gd.gid
    ),
    returned AS (
        SELECT
            gd.gid,
            SUM(s.val) / 1000.0 AS returned_kwh
        FROM group_devices gd
        JOIN device_em.stats s
          ON s.device = gd.dev_id
         AND s.ts >= p_from
         AND s.ts <  p_to
         AND s.tag = 'total_act_ret_energy'
        GROUP BY gd.gid
    ),
    pwr AS (
        SELECT
            gd.gid,
            AVG(s.val) AS avg_w,
            MAX(s.val) AS peak_w,
            COUNT(DISTINCT gd.dev_id)::INTEGER AS online_devices
        FROM group_devices gd
        JOIN device_em.stats s
          ON s.device = gd.dev_id
         AND s.ts >= p_from
         AND s.ts <  p_to
         AND s.tag = 'power'
        GROUP BY gd.gid
    )
    SELECT
        gt.gid                               AS group_id,
        gt.gname::TEXT                       AS group_name,
        COALESCE(e.total_kwh,  0)::NUMERIC   AS total_kwh,
        COALESCE(r.returned_kwh, 0)::NUMERIC AS returned_kwh,
        COALESCE(p.avg_w,      0)::NUMERIC   AS avg_power_w,
        COALESCE(p.peak_w,     0)::NUMERIC   AS peak_power_w,
        COALESCE(p.online_devices, 0)        AS device_count,
        gt.total_devices                     AS total_device_count
    FROM group_totals gt
    LEFT JOIN energy   e ON e.gid = gt.gid
    LEFT JOIN returned r ON r.gid = gt.gid
    LEFT JOIN pwr      p ON p.gid = gt.gid
    ORDER BY gt.gid;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_energy_summary(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER[]);
