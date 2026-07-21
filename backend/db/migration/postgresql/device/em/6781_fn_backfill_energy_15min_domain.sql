--------------UP
-- fn_backfill_energy_15min (6749) inserted hole-fill rows WITHOUT the domain
-- column, so domain fell to its 'ac_mains' default and the commodity trigger
-- (6779) stamped every water/heat/DC hole as electricity/ac_mains — hiding it
-- from commodity reports and inflating the AC total. Carry the source row's
-- domain through so the trigger derives the right commodity/electrical_source.
-- Only the INSERT/SELECT/GROUP BY change; the driver + hole-report are untouched.
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_backfill_energy_15min(
    p_from TIMESTAMPTZ,
    p_to   TIMESTAMPTZ,
    p_tags VARCHAR(30)[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_inserted BIGINT;
BEGIN
    SET LOCAL statement_timeout = '120s';
    SET LOCAL lock_timeout       = '5s';
    SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, domain, sum_val, sample_count, min_val, max_val)
    SELECT
        time_bucket(INTERVAL '15 min', s.ts),
        s.device, s.phase, s.channel, s.tag, s.domain,
        SUM(s.val::DOUBLE PRECISION),
        COUNT(*),
        MIN(s.val::DOUBLE PRECISION),
        MAX(s.val::DOUBLE PRECISION)
    FROM device_em.stats s
    WHERE s.ts >= p_from AND s.ts < p_to
      AND (p_tags IS NULL OR s.tag = ANY (p_tags))
    GROUP BY 1, s.device, s.phase, s.channel, s.tag, s.domain
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$;
--------------DOWN
-- Restore the 6749 domain-blind hole-fill (domain defaults to 'ac_mains').
SET search_path TO device_em, public;
CREATE OR REPLACE FUNCTION device_em.fn_backfill_energy_15min(
    p_from TIMESTAMPTZ,
    p_to   TIMESTAMPTZ,
    p_tags VARCHAR(30)[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_inserted BIGINT;
BEGIN
    SET LOCAL statement_timeout = '120s';
    SET LOCAL lock_timeout       = '5s';
    SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, sum_val, sample_count, min_val, max_val)
    SELECT
        time_bucket(INTERVAL '15 min', s.ts),
        s.device, s.phase, s.channel, s.tag,
        SUM(s.val::DOUBLE PRECISION),
        COUNT(*),
        MIN(s.val::DOUBLE PRECISION),
        MAX(s.val::DOUBLE PRECISION)
    FROM device_em.stats s
    WHERE s.ts >= p_from AND s.ts < p_to
      AND (p_tags IS NULL OR s.tag = ANY (p_tags))
    GROUP BY 1, s.device, s.phase, s.channel, s.tag
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$;
