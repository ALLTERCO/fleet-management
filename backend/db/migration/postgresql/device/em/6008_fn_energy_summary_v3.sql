--------------UP
-- v3: scope-aware. Reads device list from device.fn_resolve_scope, so
-- group / location / tag / fleet share one resolver. v2 (6007) accepted
-- only group ids; v3 takes scope_kind + scope_id. Aggregation logic
-- unchanged from v2 — same SUM(val)/1000 over device_em.stats tags.
DROP FUNCTION IF EXISTS device_em.fn_energy_summary(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER[]);

CREATE OR REPLACE FUNCTION device_em.fn_energy_summary(
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ,
    p_org_id      VARCHAR,
    p_scope_kind  TEXT     DEFAULT 'fleet',
    p_scope_id    INTEGER  DEFAULT NULL
)
RETURNS TABLE (
    scope_kind          TEXT,
    scope_id            INTEGER,
    scope_name          TEXT,
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
    WITH scoped AS (
        SELECT * FROM device.fn_resolve_scope(p_org_id, p_scope_kind, p_scope_id)
    ),
    totals AS (
        SELECT
            COUNT(DISTINCT s.dev_id)::INTEGER AS total_devices,
            MIN(s.scope_kind)                 AS sk,
            MIN(s.scope_id)                   AS sid,
            MIN(s.scope_name)                 AS sname
        FROM scoped s
    ),
    energy AS (
        SELECT SUM(st.val) / 1000.0 AS total_kwh
        FROM scoped sc
        JOIN device_em.stats st
          ON st.device = sc.dev_id
         AND st.ts >= p_from
         AND st.ts <  p_to
         AND st.tag = 'total_act_energy'
    ),
    returned AS (
        SELECT SUM(st.val) / 1000.0 AS returned_kwh
        FROM scoped sc
        JOIN device_em.stats st
          ON st.device = sc.dev_id
         AND st.ts >= p_from
         AND st.ts <  p_to
         AND st.tag = 'total_act_ret_energy'
    ),
    pwr AS (
        SELECT
            AVG(st.val)                         AS avg_w,
            MAX(st.val)                         AS peak_w,
            COUNT(DISTINCT sc.dev_id)::INTEGER  AS online_devices
        FROM scoped sc
        JOIN device_em.stats st
          ON st.device = sc.dev_id
         AND st.ts >= p_from
         AND st.ts <  p_to
         AND st.tag = 'power'
    )
    SELECT
        COALESCE(t.sk, p_scope_kind)::TEXT     AS scope_kind,
        t.sid                                   AS scope_id,
        COALESCE(t.sname, '')::TEXT             AS scope_name,
        COALESCE(e.total_kwh,    0)::NUMERIC    AS total_kwh,
        COALESCE(r.returned_kwh, 0)::NUMERIC    AS returned_kwh,
        COALESCE(p.avg_w,        0)::NUMERIC    AS avg_power_w,
        COALESCE(p.peak_w,       0)::NUMERIC    AS peak_power_w,
        COALESCE(p.online_devices, 0)           AS device_count,
        COALESCE(t.total_devices, 0)            AS total_device_count
    FROM totals t
    LEFT JOIN energy   e ON true
    LEFT JOIN returned r ON true
    LEFT JOIN pwr      p ON true;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_energy_summary(TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR, TEXT, INTEGER);
