-- Every writer that adds rollup_dirty rows takes them in one order. Two writers
-- inserting overlapping buckets in different orders can each wait on the other.
--------------UP

CREATE OR REPLACE FUNCTION device_em.fn_append_stats_dirty(
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
        ORDER BY 1, 2, 3, 4, 5, 6
        ON CONFLICT (bucket, device, tag, domain, phase, channel)
            DO UPDATE SET last_dirty = now()
        RETURNING 1
    )
    SELECT i.device, i.tag, i.domain, i.phase, i.channel,
           EXTRACT(EPOCH FROM i.ts)::BIGINT, i.val
    FROM ins i
    CROSS JOIN (SELECT count(*) FROM dirty) ensure_dirty_exec;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch_v2(
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
    p_sync_channel  INT[],
    p_period        INT[]
)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_count BIGINT;
BEGIN
    IF p_period IS NOT NULL AND (
        cardinality(p_period) <> cardinality(p_ts)
        OR EXISTS (SELECT 1 FROM unnest(p_period) p WHERE p <= 0)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EM_SYNC_PERIOD_INVALID';
    END IF;
    WITH ins AS MATERIALIZED (
        INSERT INTO device_em.stats
            (device, tag, domain, phase, channel, ts, val, source, sample_period)
        SELECT DISTINCT ON
               (u.device, u.tag, u.domain, u.phase, u.channel, u._ts, u.val, u.period)
               u.device, u.tag, u.domain, u.phase, u.channel,
               to_timestamp(u._ts), u.val, p_source, u.period
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val, p_period)
             AS u(device, tag, domain, phase, channel, _ts, val, period)
        ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts, u.val, u.period
        RETURNING device, tag, domain, phase, channel, ts
    ),
    dirty AS (
        INSERT INTO device_em.rollup_dirty
            (bucket, device, tag, domain, phase, channel)
        SELECT DISTINCT
               time_bucket(INTERVAL '15 min', i.ts),
               i.device, i.tag, i.domain, i.phase, i.channel
        FROM ins i
        ORDER BY 1, 2, 3, 4, 5, 6
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
        ON CONFLICT (device, channel)
        DO UPDATE SET created =
            GREATEST(device_em.sync.created, EXCLUDED.created)
        RETURNING 1
    )
    SELECT count(*)::BIGINT INTO v_count
    FROM ins
    CROSS JOIN (SELECT count(*) FROM dirty) ensure_dirty_exec
    CROSS JOIN (SELECT count(*) FROM bm) ensure_bm_exec;
    RETURN v_count;
END;
$$;

--------------DOWN

CREATE OR REPLACE FUNCTION device_em.fn_append_stats_dirty(
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

CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch_v2(
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
    p_sync_channel  INT[],
    p_period        INT[]
)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_count BIGINT;
BEGIN
    IF p_period IS NOT NULL AND (
        cardinality(p_period) <> cardinality(p_ts)
        OR EXISTS (SELECT 1 FROM unnest(p_period) p WHERE p <= 0)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EM_SYNC_PERIOD_INVALID';
    END IF;
    WITH ins AS MATERIALIZED (
        INSERT INTO device_em.stats
            (device, tag, domain, phase, channel, ts, val, source, sample_period)
        SELECT DISTINCT ON
               (u.device, u.tag, u.domain, u.phase, u.channel, u._ts, u.val, u.period)
               u.device, u.tag, u.domain, u.phase, u.channel,
               to_timestamp(u._ts), u.val, p_source, u.period
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val, p_period)
             AS u(device, tag, domain, phase, channel, _ts, val, period)
        ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts, u.val, u.period
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
        ON CONFLICT (device, channel)
        DO UPDATE SET created =
            GREATEST(device_em.sync.created, EXCLUDED.created)
        RETURNING 1
    )
    SELECT count(*)::BIGINT INTO v_count
    FROM ins
    CROSS JOIN (SELECT count(*) FROM dirty) ensure_dirty_exec
    CROSS JOIN (SELECT count(*) FROM bm) ensure_bm_exec;
    RETURN v_count;
END;
$$;
