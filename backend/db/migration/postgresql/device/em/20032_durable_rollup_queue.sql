--------------UP
-- Separate durable raw ingestion from the derived 15-minute projection.
-- Raw rows, per-device/channel bookmarks, and dirty-bucket markers commit in
-- one statement. The projection worker can then recompute each unique bucket
-- once, independently of how many small device blocks touched it.
SET search_path TO device_em, public;

CREATE TABLE device_em.rollup_dirty (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bucket      TIMESTAMPTZ NOT NULL,
    device      INT NOT NULL,
    tag         VARCHAR(30) NOT NULL,
    domain      VARCHAR(16) NOT NULL,
    phase       VARCHAR(1),
    channel     SMALLINT,
    first_dirty TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_dirty  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX rollup_dirty_key
    ON device_em.rollup_dirty
       (bucket, device, tag, domain, phase, channel)
    NULLS NOT DISTINCT;

CREATE FUNCTION device_em.fn_append_stats_dirty(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_domain  VARCHAR(16)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[],
    p_source  VARCHAR(16)
)
RETURNS TABLE (
    device  INT,
    tag     VARCHAR(30),
    domain  VARCHAR(16),
    phase   VARCHAR(1),
    channel SMALLINT,
    ts      BIGINT,
    val     REAL
)
LANGUAGE sql
AS
$$
    WITH ins AS MATERIALIZED (
        INSERT INTO device_em.stats
            (device, tag, domain, phase, channel, ts, val, source)
        SELECT DISTINCT ON
               (u.device, u.tag, u.domain, u.phase, u.channel, u._ts)
               u.device, u.tag, u.domain, u.phase, u.channel,
               to_timestamp(u._ts), u.val, p_source
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val)
             AS u(device, tag, domain, phase, channel, _ts, val)
        ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts
        RETURNING device, tag, domain, phase, channel, ts, val
    ),
    dirty AS (
        INSERT INTO device_em.rollup_dirty
            (bucket, device, tag, domain, phase, channel)
        SELECT DISTINCT
               time_bucket(INTERVAL '15 min', i.ts),
               i.device, i.tag, i.domain, i.phase, i.channel
        FROM ins i
        ON CONFLICT (bucket, device, tag, domain, phase, channel)
            DO UPDATE SET last_dirty = now()
        RETURNING 1
    )
    SELECT i.device, i.tag, i.domain, i.phase, i.channel,
           EXTRACT(EPOCH FROM i.ts)::BIGINT, i.val
    FROM ins i
    CROSS JOIN (SELECT count(*) FROM dirty) ensure_dirty_exec;
$$;

CREATE FUNCTION device_em.fn_append_stats_synced_batch(
    p_device        INT[],
    p_tag           VARCHAR(30)[],
    p_domain        VARCHAR(16)[],
    p_phase         VARCHAR(1)[],
    p_channel       SMALLINT[],
    p_ts            BIGINT[],
    p_val           REAL[],
    p_source        VARCHAR(16),
    p_sync_device   INT[],
    p_sync_created  BIGINT[],
    p_sync_channel  INT[]
)
RETURNS BIGINT
LANGUAGE sql
AS
$$
    WITH ins AS MATERIALIZED (
        INSERT INTO device_em.stats
            (device, tag, domain, phase, channel, ts, val, source)
        SELECT DISTINCT ON
               (u.device, u.tag, u.domain, u.phase, u.channel, u._ts)
               u.device, u.tag, u.domain, u.phase, u.channel,
               to_timestamp(u._ts), u.val, p_source
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val)
             AS u(device, tag, domain, phase, channel, _ts, val)
        ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts
        RETURNING device, tag, domain, phase, channel, ts
    ),
    dirty AS (
        INSERT INTO device_em.rollup_dirty
            (bucket, device, tag, domain, phase, channel)
        SELECT DISTINCT
               time_bucket(INTERVAL '15 min', i.ts),
               i.device, i.tag, i.domain, i.phase, i.channel
        FROM ins i
        ON CONFLICT (bucket, device, tag, domain, phase, channel)
            DO UPDATE SET last_dirty = now()
        RETURNING 1
    ),
    bm AS (
        INSERT INTO device_em.sync (device, created, channel)
        SELECT u.device, max(u.created), u.channel
        FROM unnest(p_sync_device, p_sync_created, p_sync_channel)
             AS u(device, created, channel)
        GROUP BY u.device, u.channel
        RETURNING 1
    )
    SELECT count(*)::BIGINT
    FROM ins
    CROSS JOIN (SELECT count(*) FROM dirty) ensure_dirty_exec
    CROSS JOIN (SELECT count(*) FROM bm) ensure_bm_exec;
$$;

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

CREATE FUNCTION device_em.fn_rollup_dirty_stats()
RETURNS TABLE (dirty_count BIGINT, oldest_age_seconds DOUBLE PRECISION)
LANGUAGE sql
STABLE
AS
$$
    SELECT count(*)::BIGINT,
           COALESCE(
               EXTRACT(
                   EPOCH FROM now() - (
                       SELECT d.first_dirty
                       FROM device_em.rollup_dirty d
                       ORDER BY d.id
                       LIMIT 1
                   )
               ),
               0
           )::DOUBLE PRECISION
    FROM device_em.rollup_dirty;
$$;

CREATE FUNCTION device_em.fn_rollup_dirty_in_scope(
    p_devices INT[],
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS
$$
    SELECT count(*)::BIGINT
    FROM device_em.rollup_dirty d
    WHERE d.device = ANY(p_devices)
      AND d.bucket >= time_bucket(INTERVAL '15 min', p_from)
      AND d.bucket < p_to;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_rollup_dirty_in_scope(INT[], TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS device_em.fn_rollup_dirty_stats();
DROP FUNCTION IF EXISTS device_em.fn_rollup_dirty(INT);
DROP FUNCTION IF EXISTS device_em.fn_append_stats_synced_batch(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[], VARCHAR(16), INT[], BIGINT[], INT[]);
DROP FUNCTION IF EXISTS device_em.fn_append_stats_dirty(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[], VARCHAR(16));
DROP TABLE IF EXISTS device_em.rollup_dirty;
