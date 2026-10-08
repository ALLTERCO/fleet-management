--------------UP
-- Energy.Query pricing must price the same commodity/electrical-source slice
-- as its visible rows. Replace the legacy four-argument cost reader with a
-- backwards-compatible six-argument form: old callers omit the two trailing
-- filters and retain all-domain report behaviour.

DROP FUNCTION IF EXISTS device_em.fn_report_energy_15min_by_channel(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[]
);
DROP FUNCTION IF EXISTS device_em.fn_report_energy_15min_by_channel(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, TEXT
);

CREATE FUNCTION device_em.fn_report_energy_15min_by_channel(
    p_devices INTEGER[],
    p_from TIMESTAMP WITH TIME ZONE,
    p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[],
    p_commodity TEXT DEFAULT NULL,
    p_electrical_source TEXT DEFAULT NULL
)
RETURNS TABLE (
    bucket TIMESTAMP WITH TIME ZONE,
    device INTEGER,
    channel SMALLINT,
    tag VARCHAR(30),
    energy_wh DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    SELECT s.bucket, s.device, s.channel, s.tag, SUM(s.sum_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket < p_to
      AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (
          p_electrical_source IS NULL
          OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source
      )
    GROUP BY s.bucket, s.device, s.channel, s.tag
    ORDER BY s.bucket, s.device, s.channel, s.tag;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_report_energy_15min_by_channel(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, TEXT
);

CREATE FUNCTION device_em.fn_report_energy_15min_by_channel(
    p_devices INTEGER[],
    p_from TIMESTAMP WITH TIME ZONE,
    p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[]
)
RETURNS TABLE (
    bucket TIMESTAMP WITH TIME ZONE,
    device INTEGER,
    channel SMALLINT,
    tag VARCHAR(30),
    energy_wh DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    SELECT s.bucket, s.device, s.channel, s.tag, SUM(s.sum_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket < p_to
      AND s.tag = ANY(p_tags)
    GROUP BY s.bucket, s.device, s.channel, s.tag
    ORDER BY s.bucket, s.device, s.channel, s.tag;
$$;
