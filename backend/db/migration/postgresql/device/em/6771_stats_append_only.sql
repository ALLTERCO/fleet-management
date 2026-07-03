--------------UP
-- Energy meter model, ingest plan (doc 15) Decision 1: append-only raw writes.
--
-- A UNIQUE index on a compressed hypertable forces a decompression on every
-- insert (to check the key) — the cause of the ingest incidents. Drop it and the
-- ON CONFLICT it backed; raw becomes a plain append. Cross-delivery dedup moves
-- to the rollup, which already recomputes each bucket from raw with DISTINCT ON
-- (ts) (migration 6770), so energy totals stay exact even though raw may now hold
-- a re-delivered row twice. Raw is the secondary/debug series (sub-15-minute
-- views); the rollup is the billing authority.
--
-- A non-unique index of the same columns stays for read/recompute performance —
-- it does not check uniqueness, so it does not decompress on insert.
SET search_path TO device_em, public;

DROP INDEX IF EXISTS device_em.device_em__stats_dedup;
CREATE INDEX device_em__stats_dedup
    ON device_em.stats (device, tag, domain, phase, channel, ts);

-- Append-only raw insert. No ON CONFLICT (no unique key to arbiter on). DISTINCT
-- ON still collapses duplicates WITHIN a single batch; cross-batch re-delivery is
-- deduped at the rollup. RETURNS the inserted rows so the caller rolls up the
-- buckets they touched. The 6-arg form defaults domain to 'ac_mains'.
DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
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

CREATE FUNCTION device_em.fn_append_stats(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
)
RETURNS TABLE (
    device  INT,
    tag     VARCHAR(30),
    phase   VARCHAR(1),
    channel SMALLINT,
    ts      BIGINT,
    val     REAL
)
AS
$$
    SELECT s.device, s.tag, s.phase, s.channel, s.ts, s.val
    FROM device_em.fn_append_stats(
        p_device,
        p_tag,
        array_fill('ac_mains'::VARCHAR(16), ARRAY[COALESCE(array_length(p_tag, 1), 0)]),
        p_phase,
        p_channel,
        p_ts,
        p_val
    ) AS s;
$$
LANGUAGE sql;
--------------DOWN
-- Restore the UNIQUE index + ON CONFLICT idempotent append (origin 6767/6768).
SET search_path TO device_em, public;
DROP INDEX IF EXISTS device_em.device_em__stats_dedup;
CREATE UNIQUE INDEX device_em__stats_dedup
    ON device_em.stats (device, tag, domain, phase, channel, ts) NULLS NOT DISTINCT;

DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
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
    SELECT u.device, u.tag, u.domain, u.phase, u.channel, to_timestamp(u._ts), u.val
    FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val)
         AS u(device, tag, domain, phase, channel, _ts, val)
    ON CONFLICT (device, tag, domain, phase, channel, ts) DO NOTHING
    RETURNING device, tag, domain, phase, channel,
              EXTRACT(EPOCH FROM ts)::BIGINT, val;
$$
LANGUAGE sql;

CREATE FUNCTION device_em.fn_append_stats(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
)
RETURNS TABLE (
    device  INT,
    tag     VARCHAR(30),
    phase   VARCHAR(1),
    channel SMALLINT,
    ts      BIGINT,
    val     REAL
)
AS
$$
    SELECT s.device, s.tag, s.phase, s.channel, s.ts, s.val
    FROM device_em.fn_append_stats(
        p_device,
        p_tag,
        array_fill('ac_mains'::VARCHAR(16), ARRAY[COALESCE(array_length(p_tag, 1), 0)]),
        p_phase,
        p_channel,
        p_ts,
        p_val
    ) AS s;
$$
LANGUAGE sql;
