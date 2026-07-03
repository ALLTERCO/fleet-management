--------------UP
-- Raw append that feeds the 15-minute rollup. RETURNS the rows it inserted so
-- the caller rolls up exactly the readings that were newly stored.
--
-- Dedup is INTRA-BATCH ONLY (DISTINCT ON over the incoming arrays). An earlier
-- version of this migration also ran a cross-table `NOT EXISTS` anti-join
-- against device_em.stats to skip already-stored readings. That was REMOVED
-- because it is pathologically slow on a compressed hypertable: the probe key
-- (ts) comes from the unnested batch, so TimescaleDB cannot prune chunks at
-- plan time and every call sequentially scans ALL chunks — decompressing the
-- compressed ones — instead of doing an index probe. Under concurrent
-- ingestion this pinned every connection for minutes and exhausted the pool.
-- (A UNIQUE index + ON CONFLICT would prune per-row, but a UNIQUE index cannot
-- be created on a compressed hypertable — that was the original 6746 problem.)
--
-- Cross-batch idempotency (a reading re-delivered in a later batch, e.g. on
-- device reconnect) is intentionally NOT handled here: it cannot be done
-- cheaply against compressed history, and matches the long-standing pre-rollup
-- behaviour of this function (plain insert, no dedup). Bucket-level idempotency
-- belongs in the rollup writer fn_append_energy_15min, not in a full scan of
-- raw stats on every append.
--
-- DROP first: the prior fn_append_stats RETURNS void, and CREATE OR REPLACE
-- cannot change a function's return type.
DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
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
    -- DISTINCT ON collapses exact-key duplicates within this batch so a single
    -- reading is rolled up at most once per call. NULL phase/channel sort and
    -- group together, matching the prior NULLS NOT DISTINCT intent. No table
    -- scan: inserts land in the recent (uncompressed) chunk at ingest speed.
    INSERT INTO device_em.stats (device, tag, phase, channel, ts, val)
    SELECT DISTINCT ON (u.device, u.tag, u.phase, u.channel, u._ts)
           u.device, u.tag, u.phase, u.channel, to_timestamp(u._ts), u.val
    FROM unnest(p_device, p_tag, p_phase, p_channel, p_ts, p_val)
         AS u(device, tag, phase, channel, _ts, val)
    ORDER BY u.device, u.tag, u.phase, u.channel, u._ts
    RETURNING device, tag, phase, channel, EXTRACT(EPOCH FROM ts)::BIGINT, val;
$$
LANGUAGE sql;
--------------DOWN
-- Restore the prior append (raw insert only, RETURNS void).
DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
CREATE FUNCTION device_em.fn_append_stats(
    p_device INT[],
    p_tag VARCHAR (30)[],
    p_phase VARCHAR (1)[],
    p_channel SMALLINT[],
    p_ts BIGINT[],
    p_val REAL[]
)
RETURNS void
AS
$$
    INSERT INTO device_em.stats (device, tag, phase, channel, ts, val)
    SELECT device, tag, phase, channel, to_timestamp(_ts), val
    FROM unnest(p_device, p_tag, p_phase, p_channel, p_ts, p_val) as u(device, tag, phase, channel, _ts, val);
$$
LANGUAGE sql;
