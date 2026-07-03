--------------UP
-- Distinct measurement points a set of devices has actually stored, for the
-- device Energy assignment UI. One row per point with the latest sample.
-- device_em has no componentKey, so the handler labels it from live snapshots.

CREATE OR REPLACE FUNCTION device_em.fn_list_measurement_points(
    p_devices INTEGER[]
)
RETURNS TABLE (
    device       INTEGER,
    channel      SMALLINT,
    phase        VARCHAR(1),
    tag          VARCHAR(30),
    domain       VARCHAR(16),
    sum_val      DOUBLE PRECISION,
    sample_count BIGINT,
    sample_ts    TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT ON (em.device, em.channel, em.phase, em.tag, em.domain)
        em.device, em.channel, em.phase, em.tag, em.domain,
        em.sum_val, em.sample_count, em.bucket
    FROM device_em.energy_15min em
    WHERE em.device = ANY(p_devices)
    ORDER BY em.device, em.channel, em.phase, em.tag, em.domain, em.bucket DESC;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_list_measurement_points(INTEGER[]);
