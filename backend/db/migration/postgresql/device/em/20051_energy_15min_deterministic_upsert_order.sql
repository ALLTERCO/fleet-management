--------------UP
-- Deadlock (40P01) between the two writers of device_em.energy_15min.
--
-- Both upsert the same (bucket, device, tag, domain, phase, channel) keys, and
-- both emitted their rows straight out of a GROUP BY — hash-aggregate order,
-- which differs per session. The energy seeder's day-batch transaction and a
-- rollup worker's batch would each hold an index tuple the other wanted:
--
--   ERROR: deadlock detected
--   CONTEXT: while inserting index tuple (1767,63) in relation "_hyper_17_8_chunk"
--            SQL function "fn_append_energy_15min" statement 1
--
-- The seeder cannot retry — it is bash and psql with ON_ERROR_STOP, so the
-- whole CI seed job dies. The rollup worker survives by re-polling, which is
-- why only one side of the pair was ever seen failing.
--
-- Fix is a fixed insert order in both, so every writer takes the index locks
-- in the same sequence. Row set and DO UPDATE results are unchanged. Same
-- remedy already used for this exact failure in bluetoothProvenance.ts.
--
-- Both must change. Ordering one writer and not the other leaves the cycle.

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
    -- ORDER matters, and not for the output. Two transactions upserting the
    -- same keys in different orders block on each other's index tuples and
    -- deadlock (40P01). A fixed order makes every writer take those locks in
    -- the same sequence. Same rows, same result, no cycle.
    ORDER BY bucket, device, tag, domain, phase, channel
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = EXCLUDED.sum_val,
        sample_count = EXCLUDED.sample_count,
        min_val      = EXCLUDED.min_val,
        max_val      = EXCLUDED.max_val;
$$;

DROP FUNCTION IF EXISTS device_em.fn_rollup_dirty(INT);

CREATE FUNCTION device_em.fn_rollup_dirty(p_limit INT DEFAULT 500)
RETURNS INT
LANGUAGE plpgsql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
DECLARE
    v_done INT;
BEGIN
    WITH claimed AS MATERIALIZED (
        SELECT d.id, d.bucket, d.device, d.tag, d.domain, d.phase, d.channel
        FROM device_em.rollup_dirty d
        ORDER BY d.id
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, p_limit)
    ),
    recomputed AS MATERIALIZED (
        SELECT
            c.bucket, c.device, c.tag, c.domain, c.phase, c.channel,
            SUM(v.val) AS sum_val,
            COUNT(*) AS sample_count,
            MIN(v.val) AS min_val,
            MAX(v.val) AS max_val
        FROM claimed c
        CROSS JOIN LATERAL (
            SELECT bool_or(g.source = 'em_sync') AS has_emsync
            FROM device_em.stats g
            WHERE g.device = c.device
              AND g.tag = c.tag
              AND g.domain = c.domain
              AND g.phase IS NOT DISTINCT FROM c.phase
              AND g.channel IS NOT DISTINCT FROM c.channel
              AND g.ts >= c.bucket
              AND g.ts < c.bucket + INTERVAL '15 min'
        ) gate
        CROSS JOIN LATERAL (
            SELECT DISTINCT ON (s.ts) s.val::DOUBLE PRECISION AS val
            FROM device_em.stats s
            WHERE s.device = c.device
              AND s.tag = c.tag
              AND s.domain = c.domain
              AND s.phase IS NOT DISTINCT FROM c.phase
              AND s.channel IS NOT DISTINCT FROM c.channel
              AND s.ts >= c.bucket
              AND s.ts < c.bucket + INTERVAL '15 min'
              AND CASE
                      WHEN COALESCE(gate.has_emsync, FALSE)
                          THEN s.source = 'em_sync'
                      ELSE TRUE
                  END
            ORDER BY s.ts
        ) v
        GROUP BY c.bucket, c.device, c.tag, c.domain, c.phase, c.channel
    ),
    upserted AS (
        INSERT INTO device_em.energy_15min
            (bucket, device, phase, channel, tag, domain,
             sum_val, sample_count, min_val, max_val)
        SELECT bucket, device, phase, channel, tag, domain,
               sum_val, sample_count, min_val, max_val
        FROM recomputed
        -- Same fixed lock order as fn_append_energy_15min. Ordering one writer
        -- and not the other leaves the cycle intact.
        ORDER BY bucket, device, tag, domain, phase, channel
        ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
        SET sum_val = EXCLUDED.sum_val,
            sample_count = EXCLUDED.sample_count,
            min_val = EXCLUDED.min_val,
            max_val = EXCLUDED.max_val
        RETURNING 1
    ),
    deleted AS (
        DELETE FROM device_em.rollup_dirty d
        USING claimed c
        WHERE d.id = c.id
        RETURNING 1
    )
    SELECT count(*)::INT INTO v_done
    FROM deleted
    CROSS JOIN (SELECT count(*) FROM upserted) ensure_upsert_exec;
    RETURN v_done;
END;
$$;

--------------DOWN
-- Restores the unordered inserts exactly as 6773 and 20032 defined them.
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

DROP FUNCTION IF EXISTS device_em.fn_rollup_dirty(INT);

CREATE FUNCTION device_em.fn_rollup_dirty(p_limit INT DEFAULT 500)
RETURNS INT
LANGUAGE plpgsql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
DECLARE
    v_done INT;
BEGIN
    WITH claimed AS MATERIALIZED (
        SELECT d.id, d.bucket, d.device, d.tag, d.domain, d.phase, d.channel
        FROM device_em.rollup_dirty d
        ORDER BY d.id
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, p_limit)
    ),
    recomputed AS MATERIALIZED (
        SELECT
            c.bucket, c.device, c.tag, c.domain, c.phase, c.channel,
            SUM(v.val) AS sum_val,
            COUNT(*) AS sample_count,
            MIN(v.val) AS min_val,
            MAX(v.val) AS max_val
        FROM claimed c
        CROSS JOIN LATERAL (
            SELECT bool_or(g.source = 'em_sync') AS has_emsync
            FROM device_em.stats g
            WHERE g.device = c.device
              AND g.tag = c.tag
              AND g.domain = c.domain
              AND g.phase IS NOT DISTINCT FROM c.phase
              AND g.channel IS NOT DISTINCT FROM c.channel
              AND g.ts >= c.bucket
              AND g.ts < c.bucket + INTERVAL '15 min'
        ) gate
        CROSS JOIN LATERAL (
            SELECT DISTINCT ON (s.ts) s.val::DOUBLE PRECISION AS val
            FROM device_em.stats s
            WHERE s.device = c.device
              AND s.tag = c.tag
              AND s.domain = c.domain
              AND s.phase IS NOT DISTINCT FROM c.phase
              AND s.channel IS NOT DISTINCT FROM c.channel
              AND s.ts >= c.bucket
              AND s.ts < c.bucket + INTERVAL '15 min'
              AND CASE
                      WHEN COALESCE(gate.has_emsync, FALSE)
                          THEN s.source = 'em_sync'
                      ELSE TRUE
                  END
            ORDER BY s.ts
        ) v
        GROUP BY c.bucket, c.device, c.tag, c.domain, c.phase, c.channel
    ),
    upserted AS (
        INSERT INTO device_em.energy_15min
            (bucket, device, phase, channel, tag, domain,
             sum_val, sample_count, min_val, max_val)
        SELECT bucket, device, phase, channel, tag, domain,
               sum_val, sample_count, min_val, max_val
        FROM recomputed
        ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
        SET sum_val = EXCLUDED.sum_val,
            sample_count = EXCLUDED.sample_count,
            min_val = EXCLUDED.min_val,
            max_val = EXCLUDED.max_val
        RETURNING 1
    ),
    deleted AS (
        DELETE FROM device_em.rollup_dirty d
        USING claimed c
        WHERE d.id = c.id
        RETURNING 1
    )
    SELECT count(*)::INT INTO v_done
    FROM deleted
    CROSS JOIN (SELECT count(*) FROM upserted) ensure_upsert_exec;
    RETURN v_done;
END;
$$;
