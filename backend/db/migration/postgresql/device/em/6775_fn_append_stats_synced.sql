--------------UP
-- Append em-sync raw rows and advance the sync bookmark in ONE statement, so
-- the cursor can never commit ahead of (or behind) the data it covers. The raw
-- insert mirrors fn_append_stats (append-only, within-batch dedup, source tag);
-- the bookmark insert mirrors fn_synced. Both run in the single transaction of
-- the function call: if the bookmark write fails, the raw rows roll back too.
SET search_path TO device_em, public;

DROP FUNCTION IF EXISTS device_em.fn_append_stats_synced(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[], VARCHAR(16), INT, BIGINT, INT);
CREATE FUNCTION device_em.fn_append_stats_synced(
    p_device       INT[],
    p_tag          VARCHAR(30)[],
    p_domain       VARCHAR(16)[],
    p_phase        VARCHAR(1)[],
    p_channel      SMALLINT[],
    p_ts           BIGINT[],
    p_val          REAL[],
    p_source       VARCHAR(16),
    p_sync_device  INT,
    p_sync_created BIGINT,
    p_sync_channel INT
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
    WITH ins AS (
        INSERT INTO device_em.stats (device, tag, domain, phase, channel, ts, val, source)
        SELECT DISTINCT ON (u.device, u.tag, u.domain, u.phase, u.channel, u._ts)
               u.device, u.tag, u.domain, u.phase, u.channel,
               to_timestamp(u._ts), u.val, p_source
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val)
             AS u(device, tag, domain, phase, channel, _ts, val)
        ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts
        RETURNING device, tag, domain, phase, channel,
                  EXTRACT(EPOCH FROM ts)::BIGINT AS ts, val
    ),
    bm AS (
        -- Runs even though the final SELECT reads only `ins`: Postgres always
        -- executes a data-modifying CTE to completion. One statement = one
        -- transaction, so a failed bookmark rolls the raw insert back.
        INSERT INTO device_em.sync (device, created, channel)
        VALUES (p_sync_device, p_sync_created, p_sync_channel)
        RETURNING 1
    )
    SELECT device, tag, domain, phase, channel, ts, val FROM ins;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_append_stats_synced(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[], VARCHAR(16), INT, BIGINT, INT);
