--------------UP
-- Domain-aware, idempotent raw append. The 7-arg form carries domain and skips
-- a reading already stored (ON CONFLICT on the 6767 unique key), RETURNING only
-- the rows actually inserted so the caller rolls up each reading once. The 6-arg
-- form is kept as a wrapper (domain defaults to 'ac_mains') for older callers.
DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
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
--------------DOWN
-- Restore the origin 6747 form: single 6-arg, plain DISTINCT ON insert.
DROP FUNCTION IF EXISTS device_em.fn_append_stats(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[], REAL[]);
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
    INSERT INTO device_em.stats (device, tag, phase, channel, ts, val)
    SELECT DISTINCT ON (u.device, u.tag, u.phase, u.channel, u._ts)
           u.device, u.tag, u.phase, u.channel, to_timestamp(u._ts), u.val
    FROM unnest(p_device, p_tag, p_phase, p_channel, p_ts, p_val)
         AS u(device, tag, phase, channel, _ts, val)
    ORDER BY u.device, u.tag, u.phase, u.channel, u._ts
    RETURNING device, tag, phase, channel, EXTRACT(EPOCH FROM ts)::BIGINT, val;
$$
LANGUAGE sql;
