--------------UP
-- Make the 15-minute energy rollup billing-grade. Live (15s) and em-sync (1m)
-- write the same energy tags on different timestamp grids, so summing both
-- double-counts. em-sync is the meter's own record and the billing authority.
-- Per affected bucket, recompute from em-sync rows when any exist, else fall
-- back to live; single-source buckets are unchanged. DISTINCT ON (ts) still
-- collapses a re-delivered reading within the chosen source.
SET search_path TO device_em, public;

DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
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
    WITH affected AS (
        SELECT DISTINCT
            time_bucket(INTERVAL '15 min', to_timestamp(u._ts)) AS bucket,
            u.device, u.tag, u.domain, u.phase, u.channel
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts)
             AS u(device, tag, domain, phase, channel, _ts)
    ),
    recomputed AS (
        SELECT
            a.bucket, a.device, a.tag, a.domain, a.phase, a.channel,
            SUM(d.val)   AS sum_val,
            COUNT(*)     AS sample_count,
            MIN(d.val)   AS min_val,
            MAX(d.val)   AS max_val
        FROM affected a
        -- Does this bucket carry any em-sync (billing) reading?
        CROSS JOIN LATERAL (
            SELECT bool_or(g.source = 'em_sync') AS has_emsync
            FROM device_em.stats g
            WHERE g.device  = a.device
              AND g.tag     = a.tag
              AND g.domain  = a.domain
              AND g.phase   IS NOT DISTINCT FROM a.phase
              AND g.channel IS NOT DISTINCT FROM a.channel
              AND g.ts >= a.bucket
              AND g.ts <  a.bucket + INTERVAL '15 min'
        ) gate
        CROSS JOIN LATERAL (
            -- One value per timestamp from the chosen source: em-sync when the
            -- bucket has it, else live.
            SELECT DISTINCT ON (s.ts) s.val::DOUBLE PRECISION AS val
            FROM device_em.stats s
            WHERE s.device  = a.device
              AND s.tag     = a.tag
              AND s.domain  = a.domain
              AND s.phase   IS NOT DISTINCT FROM a.phase
              AND s.channel IS NOT DISTINCT FROM a.channel
              AND s.ts >= a.bucket
              AND s.ts <  a.bucket + INTERVAL '15 min'
              AND CASE
                      WHEN COALESCE(gate.has_emsync, FALSE)
                          THEN s.source = 'em_sync'
                      ELSE TRUE
                  END
            ORDER BY s.ts
        ) d
        GROUP BY a.bucket, a.device, a.tag, a.domain, a.phase, a.channel
    )
    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, domain,
         sum_val, sample_count, min_val, max_val)
    SELECT
        bucket, device, phase, channel, tag, domain,
        sum_val, sample_count, min_val, max_val
    FROM recomputed
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = EXCLUDED.sum_val,
        sample_count = EXCLUDED.sample_count,
        min_val      = EXCLUDED.min_val,
        max_val      = EXCLUDED.max_val;
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
-- Restore the source-blind recompute (origin 6770): sums every source in the
-- bucket, deduped by timestamp only.
SET search_path TO device_em, public;
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
DROP FUNCTION IF EXISTS device_em.fn_append_energy_15min(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
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
    WITH affected AS (
        SELECT DISTINCT
            time_bucket(INTERVAL '15 min', to_timestamp(u._ts)) AS bucket,
            u.device, u.tag, u.domain, u.phase, u.channel
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts)
             AS u(device, tag, domain, phase, channel, _ts)
    ),
    recomputed AS (
        SELECT
            a.bucket, a.device, a.tag, a.domain, a.phase, a.channel,
            SUM(d.val)   AS sum_val,
            COUNT(*)     AS sample_count,
            MIN(d.val)   AS min_val,
            MAX(d.val)   AS max_val
        FROM affected a
        CROSS JOIN LATERAL (
            SELECT DISTINCT ON (s.ts) s.val::DOUBLE PRECISION AS val
            FROM device_em.stats s
            WHERE s.device  = a.device
              AND s.tag     = a.tag
              AND s.domain  = a.domain
              AND s.phase   IS NOT DISTINCT FROM a.phase
              AND s.channel IS NOT DISTINCT FROM a.channel
              AND s.ts >= a.bucket
              AND s.ts <  a.bucket + INTERVAL '15 min'
            ORDER BY s.ts
        ) d
        GROUP BY a.bucket, a.device, a.tag, a.domain, a.phase, a.channel
    )
    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, domain,
         sum_val, sample_count, min_val, max_val)
    SELECT
        bucket, device, phase, channel, tag, domain,
        sum_val, sample_count, min_val, max_val
    FROM recomputed
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = EXCLUDED.sum_val,
        sample_count = EXCLUDED.sample_count,
        min_val      = EXCLUDED.min_val,
        max_val      = EXCLUDED.max_val;
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
