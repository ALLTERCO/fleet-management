--------------UP
-- The raw power ladder preferred em-sync per series over the whole query
-- window. em/em1 meters now store no live rows and write their power from the
-- minute record, so a window that starts before that change would lose every
-- older live reading of the meter. The gate is now per minute: a minute that
-- has a record of the device channel uses only record rows; any other minute
-- keeps its live rows. The represented-channel scope of 20163 is unchanged.
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_power_instant(
    p_devices   INTEGER[],
    p_from      TIMESTAMP WITH TIME ZONE,
    p_to        TIMESTAMP WITH TIME ZONE,
    p_phase_tag TEXT,
    p_total_tag TEXT
)
RETURNS TABLE (
    device INTEGER,
    ts     TIMESTAMP WITH TIME ZONE,
    watts  DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    WITH scoped AS (
        SELECT s.device, s.tag, s.phase, s.channel, s.ts, s.source,
               s.val::DOUBLE PRECISION AS val
        FROM device_em.fn_logical_stats_in_scope(p_devices) s
        WHERE s.ts >= p_from
          AND s.ts <  p_to
          AND s.tag IN (p_phase_tag, p_total_tag)
          -- Without this a device metering mains and a DC string sums both.
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
    ),
    -- Minutes the meter's own record covers, per device channel. A live row
    -- of such a minute would double count it, whatever its tag or phase.
    recorded AS (
        SELECT DISTINCT r.device, r.channel, date_trunc('minute', r.ts) AS minute
        FROM scoped r
        WHERE r.source = 'em_sync'
    ),
    chosen AS (
        SELECT c.device, c.tag, c.phase, c.channel, c.ts, c.val
        FROM scoped c
        WHERE c.source IS NOT DISTINCT FROM 'em_sync'
           OR NOT EXISTS (
               SELECT 1
                 FROM recorded r
                WHERE r.device = c.device
                  AND r.channel IS NOT DISTINCT FROM c.channel
                  AND r.minute = date_trunc('minute', c.ts)
           )
    ),
    -- Per-phase rows win; the meter's own total is the fallback. Adding both
    -- is the double count.
    per_instant AS (
        SELECT c.device, c.channel, c.ts,
               COALESCE(
                   SUM(c.val) FILTER (WHERE c.tag = p_phase_tag),
                   SUM(c.val) FILTER (WHERE c.tag = p_total_tag)
               ) AS watts
        FROM chosen c
        GROUP BY c.device, c.channel, c.ts
    )
    -- A monophase meter spreads its phases over channels.
    SELECT i.device, i.ts, SUM(i.watts)
    FROM per_instant i
    WHERE i.watts IS NOT NULL
    GROUP BY i.device, i.ts;
$$;
--------------DOWN
SET search_path TO device_em, public;

-- Restores the per-window series gate of 20163.
CREATE OR REPLACE FUNCTION device_em.fn_power_instant(
    p_devices   INTEGER[],
    p_from      TIMESTAMP WITH TIME ZONE,
    p_to        TIMESTAMP WITH TIME ZONE,
    p_phase_tag TEXT,
    p_total_tag TEXT
)
RETURNS TABLE (
    device INTEGER,
    ts     TIMESTAMP WITH TIME ZONE,
    watts  DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    WITH scoped AS (
        SELECT s.device, s.tag, s.phase, s.channel, s.ts, s.source,
               s.val::DOUBLE PRECISION AS val
        FROM device_em.fn_logical_stats_in_scope(p_devices) s
        WHERE s.ts >= p_from
          AND s.ts <  p_to
          AND s.tag IN (p_phase_tag, p_total_tag)
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
    ),
    gate AS (
        SELECT g.device, g.tag, g.phase, g.channel,
               bool_or(g.source = 'em_sync') AS has_emsync
        FROM scoped g
        GROUP BY g.device, g.tag, g.phase, g.channel
    ),
    chosen AS (
        SELECT c.device, c.tag, c.phase, c.channel, c.ts, c.val
        FROM scoped c
        JOIN gate
          ON gate.device  =  c.device
         AND gate.tag     =  c.tag
         AND gate.phase   IS NOT DISTINCT FROM c.phase
         AND gate.channel IS NOT DISTINCT FROM c.channel
        WHERE CASE
                  WHEN COALESCE(gate.has_emsync, FALSE)
                      THEN c.source = 'em_sync'
                  ELSE TRUE
              END
    ),
    per_instant AS (
        SELECT c.device, c.channel, c.ts,
               COALESCE(
                   SUM(c.val) FILTER (WHERE c.tag = p_phase_tag),
                   SUM(c.val) FILTER (WHERE c.tag = p_total_tag)
               ) AS watts
        FROM chosen c
        GROUP BY c.device, c.channel, c.ts
    )
    SELECT i.device, i.ts, SUM(i.watts)
    FROM per_instant i
    WHERE i.watts IS NOT NULL
    GROUP BY i.device, i.ts;
$$;
