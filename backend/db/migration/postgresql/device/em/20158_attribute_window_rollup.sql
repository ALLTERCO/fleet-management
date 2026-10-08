--------------UP
-- Raw stats are kept 7 days (20031) but attribute windows reach 90, so energy
-- sums read the 15-minute rollup for whole buckets and raw only at the edges.
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_attribute_window(
    p_devices     INTEGER[],
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ,
    p_tags        VARCHAR(30)[],
    p_aggregation TEXT
)
RETURNS TABLE (
    device       INTEGER,
    tag          VARCHAR(30),
    agg_value    DOUBLE PRECISION,
    sample_count INTEGER
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    -- Same counter list as fn_report_stats_rollup (20043) plus 20050.
    c_counter_tags CONSTANT VARCHAR(30)[] := ARRAY[
        'total_act_energy', 'total_act_ret_energy', 'volume_l', 'volume_m3',
        'volume_returned_m3', 'thermal_energy_kwh', 'charge_ah', 'discharge_ah'
    ]::VARCHAR(30)[];
    -- Matches the per_tag CASE, which sums for any aggregation it does not name.
    v_is_sum      BOOLEAN := p_aggregation IS NULL
                             OR p_aggregation NOT IN ('avg', 'max', 'latest');
    v_full_from   TIMESTAMPTZ := time_bucket(INTERVAL '15 minutes', p_from);
    v_full_to     TIMESTAMPTZ := time_bucket(INTERVAL '15 minutes', p_to);
BEGIN
    -- The first whole bucket starts at or after p_from.
    IF v_full_from < p_from THEN
        v_full_from := v_full_from + INTERVAL '15 minutes';
    END IF;

    RETURN QUERY
    WITH coincident AS (
        SELECT p.device                    AS device,
               'power'::VARCHAR(30)        AS tag,
               CASE p_aggregation
                   WHEN 'max' THEN MAX(p.watts)
                   ELSE AVG(p.watts)
               END                         AS agg_value,
               COUNT(*)::INT               AS sample_count
        FROM device_em.fn_power_instant(
                 p_devices, p_from, p_to, 'power', 'total_power') p
        WHERE p_aggregation IN ('avg', 'max')
          AND 'power' = ANY(p_tags)
        GROUP BY p.device
    ),
    -- Whole buckets only: a straddling bucket holds energy outside the window.
    counter_rollup AS (
        SELECT e.device, e.tag,
               SUM(e.sum_val)::DOUBLE PRECISION AS total,
               SUM(e.sample_count)::BIGINT       AS samples
        FROM device_em.energy_15min e
        WHERE v_is_sum
          AND e.device = ANY(p_devices)
          AND e.tag = ANY(p_tags)
          AND e.tag = ANY(c_counter_tags)
          AND e.bucket >= v_full_from
          AND e.bucket <  v_full_to
        GROUP BY e.device, e.tag
    ),
    counter_edge_raw AS (
        SELECT s.device, s.tag, s.domain, s.phase, s.channel, s.ts, s.val,
               s.source,
               time_bucket(INTERVAL '15 minutes', s.ts) AS bucket
        FROM device_em.stats s
        WHERE v_is_sum
          AND s.device = ANY(p_devices)
          AND s.tag = ANY(p_tags)
          AND s.tag = ANY(c_counter_tags)
          AND s.ts >= p_from
          AND s.ts <  p_to
          AND (s.ts < v_full_from OR s.ts >= v_full_to)
    ),
    -- The rollup's own selection (20087), so edges and buckets agree: per
    -- bucket key em-sync wins over live, and a re-delivered reading counts once.
    counter_edge_gate AS (
        SELECT g.bucket, g.device, g.tag, g.domain, g.phase, g.channel,
               COALESCE(bool_or(g.source = 'em_sync'), FALSE) AS has_emsync
        FROM counter_edge_raw g
        GROUP BY g.bucket, g.device, g.tag, g.domain, g.phase, g.channel
    ),
    counter_edge_readings AS (
        SELECT r.device, r.tag, MIN(r.val::DOUBLE PRECISION) AS val
        FROM counter_edge_raw r
        JOIN counter_edge_gate g
          ON g.bucket  =  r.bucket
         AND g.device  =  r.device
         AND g.tag     =  r.tag
         AND g.domain  =  r.domain
         AND g.phase   IS NOT DISTINCT FROM r.phase
         AND g.channel IS NOT DISTINCT FROM r.channel
        WHERE NOT g.has_emsync OR r.source = 'em_sync'
        GROUP BY r.device, r.tag, r.domain, r.phase, r.channel, r.ts
    ),
    counter_edge AS (
        SELECT c.device, c.tag,
               SUM(c.val)::DOUBLE PRECISION AS total,
               COUNT(*)::BIGINT              AS samples
        FROM counter_edge_readings c
        GROUP BY c.device, c.tag
    ),
    counter_sum AS (
        SELECT x.device                              AS device,
               x.tag                                 AS tag,
               SUM(x.total)::DOUBLE PRECISION        AS agg_value,
               SUM(x.samples)::INT                   AS sample_count
        FROM (
            SELECT * FROM counter_rollup
            UNION ALL
            SELECT * FROM counter_edge
        ) x
        GROUP BY x.device, x.tag
    ),
    per_tag AS (
        SELECT
            s.device                                    AS device,
            s.tag                                       AS tag,
            CASE p_aggregation
                WHEN 'sum'    THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
                WHEN 'avg'    THEN CAST(AVG(s.val) AS DOUBLE PRECISION)
                WHEN 'max'    THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
                WHEN 'latest' THEN (
                    SELECT CAST(s2.val AS DOUBLE PRECISION)
                    FROM device_em.stats s2
                    WHERE s2.device = s.device
                      AND s2.tag = s.tag
                      AND s2.ts >= p_from
                      AND s2.ts <  p_to
                    ORDER BY s2.ts DESC
                    LIMIT 1
                )
                ELSE CAST(SUM(s.val) AS DOUBLE PRECISION)
            END                                         AS agg_value,
            COUNT(*)::INT                               AS sample_count
        FROM device_em.stats s
        WHERE s.device = ANY(p_devices)
          AND s.ts >= p_from
          AND s.ts <  p_to
          AND s.tag  = ANY(p_tags)
          AND NOT (s.tag = 'power' AND p_aggregation IN ('avg', 'max'))
          AND NOT (v_is_sum AND s.tag = ANY(c_counter_tags))
        GROUP BY s.device, s.tag
    )
    SELECT u.device, u.tag, u.agg_value, u.sample_count
    FROM (
        SELECT * FROM coincident
        UNION ALL
        SELECT * FROM counter_sum
        UNION ALL
        SELECT * FROM per_tag
    ) u
    ORDER BY u.device, u.tag;
END;
$$;
--------------DOWN
-- Restore the 20046 body: every non-coincident tag reads raw.
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_attribute_window(
    p_devices     INTEGER[],
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ,
    p_tags        VARCHAR(30)[],
    p_aggregation TEXT
)
RETURNS TABLE (
    device       INTEGER,
    tag          VARCHAR(30),
    agg_value    DOUBLE PRECISION,
    sample_count INTEGER
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
    RETURN QUERY
    WITH coincident AS (
        SELECT p.device                    AS device,
               'power'::VARCHAR(30)        AS tag,
               CASE p_aggregation
                   WHEN 'max' THEN MAX(p.watts)
                   ELSE AVG(p.watts)
               END                         AS agg_value,
               COUNT(*)::INT               AS sample_count
        FROM device_em.fn_power_instant(
                 p_devices, p_from, p_to, 'power', 'total_power') p
        WHERE p_aggregation IN ('avg', 'max')
          AND 'power' = ANY(p_tags)
        GROUP BY p.device
    ),
    per_tag AS (
        SELECT
            s.device                                    AS device,
            s.tag                                       AS tag,
            CASE p_aggregation
                WHEN 'sum'    THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
                WHEN 'avg'    THEN CAST(AVG(s.val) AS DOUBLE PRECISION)
                WHEN 'max'    THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
                WHEN 'latest' THEN (
                    SELECT CAST(s2.val AS DOUBLE PRECISION)
                    FROM device_em.stats s2
                    WHERE s2.device = s.device
                      AND s2.tag = s.tag
                      AND s2.ts >= p_from
                      AND s2.ts <  p_to
                    ORDER BY s2.ts DESC
                    LIMIT 1
                )
                ELSE CAST(SUM(s.val) AS DOUBLE PRECISION)
            END                                         AS agg_value,
            COUNT(*)::INT                               AS sample_count
        FROM device_em.stats s
        WHERE s.device = ANY(p_devices)
          AND s.ts >= p_from
          AND s.ts <  p_to
          AND s.tag  = ANY(p_tags)
          AND NOT (s.tag = 'power' AND p_aggregation IN ('avg', 'max'))
        GROUP BY s.device, s.tag
    )
    SELECT u.device, u.tag, u.agg_value, u.sample_count
    FROM (
        SELECT * FROM coincident
        UNION ALL
        SELECT * FROM per_tag
    ) u
    ORDER BY u.device, u.tag;
END;
$$;
