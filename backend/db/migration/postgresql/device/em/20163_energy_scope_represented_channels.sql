--------------UP
-- A custom device in a query's device set owns the physical source channels it
-- represents. Rows of a source at (device, channel, tag) inside the binding
-- window of a selected custom device are that device's readings, so a scope
-- holding both counts them once and keeps the source's other channels. The
-- rule sits here, once, and every scope-sized energy read goes through it:
-- the logical relations (reports, exports, power) and the eight Energy.Query
-- stats functions, which see custom devices only when the caller lists them.
SET search_path TO device_em, public;

-- Same tag coverage as the linked rows of the logical relations (7350).
CREATE OR REPLACE FUNCTION device_em.fn_projection_field_covers(
    p_field TEXT,
    p_tag   TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT (p_field = 'voltage' AND p_tag IN ('voltage', 'min_voltage', 'max_voltage'))
        OR (p_field = 'current' AND p_tag IN ('current', 'min_current', 'max_current'))
        OR p_tag = p_field;
$$;

-- Source channels that the custom devices in p_owners represent, limited to
-- sources in p_sources. No owner, no row: a plain physical scope is unchanged.
CREATE OR REPLACE FUNCTION device_em.fn_represented_energy_sources(
    p_owners  INTEGER[],
    p_sources INTEGER[]
)
RETURNS TABLE (
    source_device    INTEGER,
    source_channel   SMALLINT,
    projection_field TEXT,
    effective_from   TIMESTAMP WITH TIME ZONE,
    effective_until  TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
AS $$
    SELECT b.source_device_list_id,
           b.source_channel,
           b.projection_field,
           b.effective_from,
           COALESCE(b.effective_to, 'infinity'::timestamptz)
      FROM device.virtual_energy_binding_projection b
     WHERE b.virtual_device_list_id = ANY(p_owners)
       AND b.source_device_list_id = ANY(p_sources);
$$;

CREATE OR REPLACE FUNCTION device_em.fn_logical_energy_15min_in_scope(
    p_devices INTEGER[]
)
RETURNS SETOF device_em.logical_energy_15min
LANGUAGE sql
STABLE
AS $$
    SELECT e.*
      FROM device_em.logical_energy_15min e
     WHERE e.device = ANY(p_devices)
       AND NOT EXISTS (
           SELECT 1
             FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
            WHERE r.source_device = e.device
              AND r.source_channel = COALESCE(e.channel, 0)
              AND e.bucket >= r.effective_from
              AND e.bucket < r.effective_until
              AND device_em.fn_projection_field_covers(r.projection_field, e.tag)
       );
$$;

CREATE OR REPLACE FUNCTION device_em.fn_logical_stats_in_scope(
    p_devices INTEGER[]
)
RETURNS SETOF device_em.logical_stats
LANGUAGE sql
STABLE
AS $$
    SELECT e.*
      FROM device_em.logical_stats e
     WHERE e.device = ANY(p_devices)
       AND NOT EXISTS (
           SELECT 1
             FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
            WHERE r.source_device = e.device
              AND r.source_channel = COALESCE(e.channel, 0)
              AND e.ts >= r.effective_from
              AND e.ts < r.effective_until
              AND device_em.fn_projection_field_covers(r.projection_field, e.tag)
       );
$$;

-- Device power (peak, average, always-on, attribution) reads the same scope.
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
    -- Live (15s) and em-sync (1m) write the same tag on different timestamp
    -- grids, so keeping both double counts. Gated per series over the window.
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

CREATE OR REPLACE FUNCTION device_em.fn_power_15min(
    p_devices   INTEGER[],
    p_from      TIMESTAMP WITH TIME ZONE,
    p_to        TIMESTAMP WITH TIME ZONE,
    p_phase_tag TEXT,
    p_total_tag TEXT
)
RETURNS TABLE (
    device   INTEGER,
    bucket   TIMESTAMP WITH TIME ZONE,
    channel  SMALLINT,
    watt_sum DOUBLE PRECISION,
    samples  BIGINT
)
LANGUAGE sql STABLE
AS $$
    WITH scoped AS (
        SELECT s.bucket, s.device, s.tag, s.phase, s.channel,
               s.sum_val, s.sample_count
        FROM device_em.fn_logical_energy_15min_in_scope(p_devices) s
        WHERE s.bucket >= p_from
          AND s.bucket <  p_to
          AND s.tag IN (p_phase_tag, p_total_tag)
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
          AND s.sample_count > 0
    )
    -- MAX(sample_count), not SUM: the phases share timestamps, so their counts
    -- are the same number and summing would divide by three times the instants.
    SELECT c.device, c.bucket, c.channel,
           COALESCE(
               SUM(c.sum_val) FILTER (WHERE c.tag = p_phase_tag),
               SUM(c.sum_val) FILTER (WHERE c.tag = p_total_tag)
           ),
           COALESCE(
               MAX(c.sample_count) FILTER (WHERE c.tag = p_phase_tag),
               MAX(c.sample_count) FILTER (WHERE c.tag = p_total_tag)
           )
    FROM scoped c
    GROUP BY c.device, c.bucket, c.channel;
$$;

-- The eight stats functions keep their signatures; only the represented rows
-- leave. Rewritten from the installed definitions, as 20050 did.
DO $migration$
DECLARE
    v_function RECORD;
    v_definition TEXT;
    v_predicate TEXT;
    v_count INTEGER := 0;
BEGIN
    FOR v_function IN
        SELECT p.oid, p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'device_em'
          AND p.proname = ANY(ARRAY[
              'fn_report_stats',
              'fn_report_stats_paged',
              'fn_report_stats_by_phase',
              'fn_report_stats_by_phase_paged',
              'fn_report_stats_rollup',
              'fn_report_stats_rollup_paged',
              'fn_report_stats_rollup_by_phase',
              'fn_report_stats_rollup_by_phase_paged'
          ])
    LOOP
        v_definition := pg_get_functiondef(v_function.oid);
        v_predicate := CASE
            WHEN v_function.proname LIKE 'fn_report_stats_rollup%'
            THEN 'AND NOT EXISTS (SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0) AND s.bucket >= r.effective_from AND s.bucket < r.effective_until AND device_em.fn_projection_field_covers(r.projection_field, s.tag)) '
            ELSE 'AND NOT EXISTS (SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0) AND s.ts >= r.effective_from AND s.ts < r.effective_until AND device_em.fn_projection_field_covers(r.projection_field, s.tag)) '
        END;
        v_count := v_count + 1;
        CONTINUE WHEN position(v_predicate IN v_definition) > 0;
        IF (length(v_definition) - length(replace(v_definition, 'GROUP BY', '')))
            / length('GROUP BY') <> 1 THEN
            RAISE EXCEPTION
                'unexpected GROUP BY count in device_em.%', v_function.proname;
        END IF;
        EXECUTE replace(v_definition, 'GROUP BY', v_predicate || 'GROUP BY');
    END LOOP;
    IF v_count <> 8 THEN
        RAISE EXCEPTION
            'expected 8 device_em report functions, found %', v_count;
    END IF;
END;
$migration$;

--------------DOWN
SET search_path TO device_em, public;

DO $migration$
DECLARE
    v_function RECORD;
    v_definition TEXT;
BEGIN
    FOR v_function IN
        SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'device_em'
          AND p.proname LIKE 'fn_report_stats%'
    LOOP
        v_definition := pg_get_functiondef(v_function.oid);
        v_definition := replace(v_definition, 'AND NOT EXISTS (SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0) AND s.bucket >= r.effective_from AND s.bucket < r.effective_until AND device_em.fn_projection_field_covers(r.projection_field, s.tag)) ', '');
        v_definition := replace(v_definition, 'AND NOT EXISTS (SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0) AND s.ts >= r.effective_from AND s.ts < r.effective_until AND device_em.fn_projection_field_covers(r.projection_field, s.tag)) ', '');
        EXECUTE v_definition;
    END LOOP;
END;
$migration$;

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
        FROM device_em.logical_stats s
        WHERE s.device = ANY(p_devices)
          AND s.ts >= p_from
          AND s.ts <  p_to
          AND s.tag IN (p_phase_tag, p_total_tag)
          -- Without this a device metering mains and a DC string sums both.
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
    ),
    -- Live (15s) and em-sync (1m) write the same tag on different timestamp
    -- grids, so keeping both double counts. Gated per series over the window.
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

CREATE OR REPLACE FUNCTION device_em.fn_power_15min(
    p_devices   INTEGER[],
    p_from      TIMESTAMP WITH TIME ZONE,
    p_to        TIMESTAMP WITH TIME ZONE,
    p_phase_tag TEXT,
    p_total_tag TEXT
)
RETURNS TABLE (
    device   INTEGER,
    bucket   TIMESTAMP WITH TIME ZONE,
    channel  SMALLINT,
    watt_sum DOUBLE PRECISION,
    samples  BIGINT
)
LANGUAGE sql STABLE
AS $$
    WITH scoped AS (
        SELECT s.bucket, s.device, s.tag, s.phase, s.channel,
               s.sum_val, s.sample_count
        FROM device_em.logical_energy_15min s
        WHERE s.device = ANY(p_devices)
          AND s.bucket >= p_from
          AND s.bucket <  p_to
          AND s.tag IN (p_phase_tag, p_total_tag)
          AND s.commodity = 'electricity'
          AND s.electrical_source IS NOT DISTINCT FROM 'ac_mains'
          AND s.sample_count > 0
    )
    -- MAX(sample_count), not SUM: the phases share timestamps, so their counts
    -- are the same number and summing would divide by three times the instants.
    SELECT c.device, c.bucket, c.channel,
           COALESCE(
               SUM(c.sum_val) FILTER (WHERE c.tag = p_phase_tag),
               SUM(c.sum_val) FILTER (WHERE c.tag = p_total_tag)
           ),
           COALESCE(
               MAX(c.sample_count) FILTER (WHERE c.tag = p_phase_tag),
               MAX(c.sample_count) FILTER (WHERE c.tag = p_total_tag)
           )
    FROM scoped c
    GROUP BY c.device, c.bucket, c.channel;
$$;

DROP FUNCTION IF EXISTS device_em.fn_logical_stats_in_scope(INTEGER[]);
DROP FUNCTION IF EXISTS device_em.fn_logical_energy_15min_in_scope(INTEGER[]);
DROP FUNCTION IF EXISTS device_em.fn_represented_energy_sources(INTEGER[], INTEGER[]);
DROP FUNCTION IF EXISTS device_em.fn_projection_field_covers(TEXT, TEXT);
