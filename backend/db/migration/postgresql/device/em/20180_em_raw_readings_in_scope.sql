-- Raw energy reads apply both shared rules in one place. 20172 gave raw reads
-- the rollup's rule (em_sync wins its bucket, each second counts once) and
-- rewrote the four raw report functions on top of it, which dropped the
-- custom-device scope 20163 had added to them. The scope now lives in
-- fn_stats_readings itself: a custom device in p_devices owns the source
-- channels it represents, so a scope holding both counts them once.
-- Readers: the four raw report functions, the custom-device raw history and
-- the raw export (logical rows).
--------------UP
CREATE OR REPLACE FUNCTION device_em.fn_stats_readings(
    p_devices INT[],
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_tags VARCHAR(30)[],
    p_logical BOOLEAN
)
RETURNS TABLE (
    ts TIMESTAMPTZ,
    device INT,
    tag VARCHAR(30),
    domain VARCHAR(16),
    phase VARCHAR(1),
    channel SMALLINT,
    val DOUBLE PRECISION,
    source VARCHAR(16),
    commodity VARCHAR(12),
    electrical_source VARCHAR(16)
)
LANGUAGE sql
STABLE
AS $$
    WITH input AS (
        SELECT s.ts, s.device, s.tag, s.domain, s.phase, s.channel,
               s.val::DOUBLE PRECISION AS val, s.source, s.commodity, s.electrical_source
        FROM device_em.stats s
        WHERE NOT p_logical AND s.device = ANY(p_devices) AND s.tag = ANY(p_tags)
          AND s.ts >= time_bucket(INTERVAL '15 min', p_from)
          AND s.ts < time_bucket(INTERVAL '15 min', p_to - INTERVAL '1 microsecond')
                     + INTERVAL '15 min'
          AND NOT EXISTS (
              SELECT 1
                FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
               WHERE r.source_device = s.device
                 AND r.source_channel = COALESCE(s.channel, 0)
                 AND s.ts >= r.effective_from
                 AND s.ts < r.effective_until
                 AND device_em.fn_projection_field_covers(r.projection_field, s.tag)
          )
        UNION ALL
        SELECT s.ts, s.device, s.tag, s.domain, s.phase, s.channel,
               s.val, s.source, s.commodity, s.electrical_source
        FROM device_em.fn_logical_stats_in_scope(p_devices) s
        WHERE p_logical AND s.tag = ANY(p_tags)
          AND s.ts >= time_bucket(INTERVAL '15 min', p_from)
          AND s.ts < time_bucket(INTERVAL '15 min', p_to - INTERVAL '1 microsecond')
                     + INTERVAL '15 min'
    ), gated AS (
        SELECT i.*,
               bool_or(i.source IS NOT DISTINCT FROM 'em_sync') OVER (
                   PARTITION BY i.device, i.tag, i.domain, i.phase, i.channel,
                                time_bucket(INTERVAL '15 min', i.ts)
               ) AS bucket_synced
        FROM input i
    )
    SELECT DISTINCT ON (g.device, g.tag, g.domain, g.phase, g.channel, g.ts)
           g.ts, g.device, g.tag, g.domain, g.phase, g.channel, g.val,
           g.source, g.commodity, g.electrical_source
    FROM gated g
    WHERE (g.source IS NOT DISTINCT FROM 'em_sync' OR NOT g.bucket_synced)
      AND g.ts >= p_from AND g.ts < p_to
    ORDER BY g.device, g.tag, g.domain, g.phase, g.channel, g.ts, g.val;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION device_em.fn_stats_readings(
    p_devices INT[],
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_tags VARCHAR(30)[],
    p_logical BOOLEAN
)
RETURNS TABLE (
    ts TIMESTAMPTZ,
    device INT,
    tag VARCHAR(30),
    domain VARCHAR(16),
    phase VARCHAR(1),
    channel SMALLINT,
    val DOUBLE PRECISION,
    source VARCHAR(16),
    commodity VARCHAR(12),
    electrical_source VARCHAR(16)
)
LANGUAGE sql
STABLE
AS $$
    WITH input AS (
        SELECT s.ts, s.device, s.tag, s.domain, s.phase, s.channel,
               s.val::DOUBLE PRECISION AS val, s.source, s.commodity, s.electrical_source
        FROM device_em.stats s
        WHERE NOT p_logical AND s.device = ANY(p_devices) AND s.tag = ANY(p_tags)
          AND s.ts >= time_bucket(INTERVAL '15 min', p_from)
          AND s.ts < time_bucket(INTERVAL '15 min', p_to - INTERVAL '1 microsecond')
                     + INTERVAL '15 min'
        UNION ALL
        SELECT s.ts, s.device, s.tag, s.domain, s.phase, s.channel,
               s.val, s.source, s.commodity, s.electrical_source
        FROM device_em.logical_stats s
        WHERE p_logical AND s.device = ANY(p_devices) AND s.tag = ANY(p_tags)
          AND s.ts >= time_bucket(INTERVAL '15 min', p_from)
          AND s.ts < time_bucket(INTERVAL '15 min', p_to - INTERVAL '1 microsecond')
                     + INTERVAL '15 min'
    ), gated AS (
        SELECT i.*,
               bool_or(i.source IS NOT DISTINCT FROM 'em_sync') OVER (
                   PARTITION BY i.device, i.tag, i.domain, i.phase, i.channel,
                                time_bucket(INTERVAL '15 min', i.ts)
               ) AS bucket_synced
        FROM input i
    )
    SELECT DISTINCT ON (g.device, g.tag, g.domain, g.phase, g.channel, g.ts)
           g.ts, g.device, g.tag, g.domain, g.phase, g.channel, g.val,
           g.source, g.commodity, g.electrical_source
    FROM gated g
    WHERE (g.source IS NOT DISTINCT FROM 'em_sync' OR NOT g.bucket_synced)
      AND g.ts >= p_from AND g.ts < p_to
    ORDER BY g.device, g.tag, g.domain, g.phase, g.channel, g.ts, g.val;
$$;
