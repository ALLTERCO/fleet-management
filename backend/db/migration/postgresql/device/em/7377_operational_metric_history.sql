--------------UP
-- Operations policies need per-channel history without bypassing the
-- electrical rollup or guessing duration from one live status snapshot.
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_operational_metric_15min_by_channel(
    p_devices INTEGER[],
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_tags VARCHAR(30)[],
    p_commodity TEXT DEFAULT NULL
)
RETURNS TABLE (
    bucket TIMESTAMPTZ,
    device INTEGER,
    channel SMALLINT,
    tag VARCHAR(30),
    value DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    SELECT
        s.bucket,
        s.device,
        s.channel,
        s.tag,
        SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket < p_to
      AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
    GROUP BY s.bucket, s.device, s.channel, s.tag
    ORDER BY s.bucket, s.device, s.channel, s.tag;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_current_history_by_channel(
    p_device INTEGER,
    p_channel SMALLINT,
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS TABLE (observed_at TIMESTAMPTZ, amps DOUBLE PRECISION)
LANGUAGE sql STABLE
AS $$
    WITH per_phase AS (
        SELECT s.ts, s.phase, AVG(s.val)::DOUBLE PRECISION AS amps
        FROM device_em.stats s
        WHERE s.device = p_device
          AND s.channel = p_channel
          AND s.ts >= p_from
          AND s.ts <= p_to
          AND s.tag = 'current'
        GROUP BY s.ts, s.phase
    )
    SELECT per_phase.ts, SUM(per_phase.amps)::DOUBLE PRECISION
    FROM per_phase
    GROUP BY per_phase.ts
    ORDER BY per_phase.ts;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_current_history_by_channel(
    INTEGER,
    SMALLINT,
    TIMESTAMPTZ,
    TIMESTAMPTZ
);
DROP FUNCTION IF EXISTS device_em.fn_operational_metric_15min_by_channel(
    INTEGER[],
    TIMESTAMPTZ,
    TIMESTAMPTZ,
    VARCHAR(30)[],
    TEXT
);
