--------------UP
SET search_path TO device_em, public;

-- A bookmark is current state, not history. Keep one row per device/channel.
DELETE FROM device_em.sync older
USING device_em.sync newer
WHERE older.device = newer.device
  AND older.channel IS NOT DISTINCT FROM newer.channel
  AND (
      older.created < newer.created
      OR (older.created = newer.created AND older.ctid < newer.ctid)
  );

CREATE UNIQUE INDEX sync_device_channel
    ON device_em.sync (device, channel)
    NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION device_em.fn_synced(
    p_device INT,
    p_created BIGINT,
    p_channel INT
)
RETURNS TABLE (created BIGINT)
LANGUAGE sql
AS
$$
    INSERT INTO device_em.sync (device, created, channel)
    VALUES (p_device, p_created, p_channel)
    ON CONFLICT (device, channel)
    DO UPDATE SET created = GREATEST(device_em.sync.created, EXCLUDED.created)
    RETURNING device_em.sync.created;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch(
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
        ON CONFLICT (device, channel)
        DO UPDATE SET created =
            GREATEST(device_em.sync.created, EXCLUDED.created)
        RETURNING 1
    )
    SELECT count(*)::BIGINT
    FROM ins
    CROSS JOIN (SELECT count(*) FROM dirty) ensure_dirty_exec
    CROSS JOIN (SELECT count(*) FROM bm) ensure_bm_exec;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch(
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

CREATE OR REPLACE FUNCTION device_em.fn_synced(
    p_device INT,
    p_created BIGINT,
    p_channel INT
)
RETURNS TABLE (created BIGINT)
LANGUAGE sql
AS
$$
    INSERT INTO device_em.sync (device, created, channel)
    VALUES (p_device, p_created, p_channel)
    RETURNING created;
$$;

DROP INDEX IF EXISTS device_em.sync_device_channel;
