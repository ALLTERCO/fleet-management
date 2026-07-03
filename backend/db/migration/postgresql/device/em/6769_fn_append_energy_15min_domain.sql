--------------UP
-- Domain-aware 15-minute rollup upsert. Folds back origin 6748's decompression-
-- cap override (lost when the rollup was made domain-aware in place): the SET
-- keeps a batch that touches compressed chunks (late emSync backfill, back-dated
-- clocks) from aborting on max_tuples_decompressed_per_dml_transaction and
-- silently under-counting. The 6-arg wrapper defaults domain to 'ac_mains'.
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
CREATE FUNCTION device_em.fn_append_energy_15min(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_domain  VARCHAR(16)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
)
RETURNS void
LANGUAGE sql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, domain,
         sum_val, sample_count, min_val, max_val)
    SELECT
        time_bucket(INTERVAL '15 min', to_timestamp(u._ts)),
        u.device, u.phase, u.channel, u.tag, u.domain,
        SUM(u.val::DOUBLE PRECISION),
        COUNT(*),
        MIN(u.val::DOUBLE PRECISION),
        MAX(u.val::DOUBLE PRECISION)
    FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val)
         AS u(device, tag, domain, phase, channel, _ts, val)
    GROUP BY 1, u.device, u.phase, u.channel, u.tag, u.domain
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = device_em.energy_15min.sum_val + EXCLUDED.sum_val,
        sample_count = device_em.energy_15min.sample_count + EXCLUDED.sample_count,
        min_val      = LEAST(device_em.energy_15min.min_val, EXCLUDED.min_val),
        max_val      = GREATEST(device_em.energy_15min.max_val, EXCLUDED.max_val);
$$;

CREATE FUNCTION device_em.fn_append_energy_15min(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
)
RETURNS void
AS
$$
    SELECT device_em.fn_append_energy_15min(
        p_device,
        p_tag,
        array_fill('ac_mains'::VARCHAR(16), ARRAY[COALESCE(array_length(p_tag, 1), 0)]),
        p_phase,
        p_channel,
        p_ts,
        p_val
    );
$$
LANGUAGE sql;
--------------DOWN
-- Restore origin 6748 form: 6-arg only, decompress override, no domain param.
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
CREATE FUNCTION device_em.fn_append_energy_15min(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
)
RETURNS void
LANGUAGE sql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag,
         sum_val, sample_count, min_val, max_val)
    SELECT
        time_bucket(INTERVAL '15 min', to_timestamp(u._ts)),
        u.device, u.phase, u.channel, u.tag,
        SUM(u.val::DOUBLE PRECISION),
        COUNT(*),
        MIN(u.val::DOUBLE PRECISION),
        MAX(u.val::DOUBLE PRECISION)
    FROM unnest(p_device, p_tag, p_phase, p_channel, p_ts, p_val)
         AS u(device, tag, phase, channel, _ts, val)
    GROUP BY 1, u.device, u.phase, u.channel, u.tag
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = device_em.energy_15min.sum_val + EXCLUDED.sum_val,
        sample_count = device_em.energy_15min.sample_count + EXCLUDED.sample_count,
        min_val      = LEAST(device_em.energy_15min.min_val, EXCLUDED.min_val),
        max_val      = GREATEST(device_em.energy_15min.max_val, EXCLUDED.max_val);
$$;
