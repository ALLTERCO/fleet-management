--------------UP
-- Energy meter model, ingest plan (doc 15) Decision 4: tag each raw reading with
-- its source and add a VEE Sum-Check.
--
-- Two writers feed device_em.stats: the 15-second live status pipeline and the
-- 1-minute em-sync (the meter's own record). em-sync is the billing authority;
-- live is the secondary/debug series. This adds a `source` tag so the two can be
-- told apart and reconciled. The rollup is unchanged — both still feed it,
-- deduped by timestamp — so there is no behaviour change here, only the data and
-- the check needed before a later commit can make the rollup billing-grade only.
SET search_path TO device_em, public;

ALTER TABLE device_em.stats
    ADD COLUMN IF NOT EXISTS source VARCHAR(16);

-- fn_append_stats now stamps a source on the rows it writes (scalar — a whole
-- batch shares one source). Defaults to 'live' so existing callers are unchanged;
-- the em-sync path passes 'em_sync'. RETURNS is unchanged (the rollup does not
-- need source).
DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
CREATE FUNCTION device_em.fn_append_stats(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_domain  VARCHAR(16)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[],
    p_source  VARCHAR(16) DEFAULT 'live'
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
AS
$$
    INSERT INTO device_em.stats (device, tag, domain, phase, channel, ts, val, source)
    SELECT DISTINCT ON (u.device, u.tag, u.domain, u.phase, u.channel, u._ts)
           u.device, u.tag, u.domain, u.phase, u.channel,
           to_timestamp(u._ts), u.val, p_source
    FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val)
         AS u(device, tag, domain, phase, channel, _ts, val)
    ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts
    RETURNING device, tag, domain, phase, channel,
              EXTRACT(EPOCH FROM ts)::BIGINT, val;
$$
LANGUAGE sql;

-- VEE Sum-Check: per 15-minute bucket and energy tag, compare the live-derived
-- sum against the em-sync (billing) sum for one device. Returns only the buckets
-- that drift beyond the tolerance — flag, never fix. An empty result is agreement.
DROP FUNCTION IF EXISTS device_em.fn_em_sum_check(INT, BIGINT, BIGINT, DOUBLE PRECISION);
CREATE FUNCTION device_em.fn_em_sum_check(
    p_device       INT,
    p_from         BIGINT,
    p_to           BIGINT,
    p_tolerance_pct DOUBLE PRECISION DEFAULT 2.0
)
RETURNS TABLE (
    bucket      TIMESTAMP WITH TIME ZONE,
    tag         VARCHAR(30),
    live_sum    DOUBLE PRECISION,
    emsync_sum  DOUBLE PRECISION,
    drift_pct   DOUBLE PRECISION
)
AS
$$
    SELECT
        q.bucket, q.tag, q.live_sum, q.emsync_sum,
        abs(q.live_sum - q.emsync_sum) / abs(q.emsync_sum) * 100.0 AS drift_pct
    FROM (
        SELECT
            time_bucket(INTERVAL '15 min', s.ts) AS bucket,
            s.tag,
            SUM(s.val::DOUBLE PRECISION)
                FILTER (WHERE COALESCE(s.source, 'live') = 'live')   AS live_sum,
            SUM(s.val::DOUBLE PRECISION)
                FILTER (WHERE s.source = 'em_sync')                  AS emsync_sum
        FROM device_em.stats s
        WHERE s.device = p_device
          AND s.ts >= to_timestamp(p_from)
          AND s.ts <  to_timestamp(p_to)
          AND s.tag IN ('total_act_energy', 'total_act_ret_energy')
        GROUP BY 1, s.tag
    ) q
    WHERE q.live_sum IS NOT NULL
      AND q.emsync_sum IS NOT NULL
      AND q.emsync_sum <> 0
      AND abs(q.live_sum - q.emsync_sum) > abs(q.emsync_sum) * (p_tolerance_pct / 100.0);
$$
LANGUAGE sql;
--------------DOWN
SET search_path TO device_em, public;
DROP FUNCTION IF EXISTS device_em.fn_em_sum_check(INT, BIGINT, BIGINT, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[], VARCHAR(16));
CREATE FUNCTION device_em.fn_append_stats(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_domain  VARCHAR(16)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
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
AS
$$
    INSERT INTO device_em.stats (device, tag, domain, phase, channel, ts, val)
    SELECT DISTINCT ON (u.device, u.tag, u.domain, u.phase, u.channel, u._ts)
           u.device, u.tag, u.domain, u.phase, u.channel,
           to_timestamp(u._ts), u.val
    FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val)
         AS u(device, tag, domain, phase, channel, _ts, val)
    ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts
    RETURNING device, tag, domain, phase, channel,
              EXTRACT(EPOCH FROM ts)::BIGINT, val;
$$
LANGUAGE sql;
ALTER TABLE device_em.stats DROP COLUMN IF EXISTS source;
