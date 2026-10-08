--------------UP
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty(p_limit INT DEFAULT 500)
RETURNS INT
LANGUAGE plpgsql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
DECLARE
    v_claimed_ids BIGINT[];
    v_done        INT;
BEGIN
    SELECT array_agg(c.id ORDER BY c.id)
    INTO v_claimed_ids
    FROM (
        SELECT d.id
        FROM device_em.rollup_dirty d
        ORDER BY d.id
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, p_limit)
    ) c;

    IF COALESCE(cardinality(v_claimed_ids), 0) = 0 THEN
        RETURN 0;
    END IF;

    WITH claimed AS MATERIALIZED (
        SELECT d.id, d.bucket, d.device, d.tag, d.domain, d.phase, d.channel
        FROM device_em.rollup_dirty d
        WHERE d.id = ANY(v_claimed_ids)
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

--------------DOWN
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty(p_limit INT DEFAULT 500)
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
