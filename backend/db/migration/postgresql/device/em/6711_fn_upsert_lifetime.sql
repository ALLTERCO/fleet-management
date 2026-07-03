--------------UP
-- Replaces 6700's void-returning version. Same UPSERT shape + same
-- reset detection (incoming cumulative < stored = reset), now also:
--   1. Increments reset_count on the row when a reset fires.
--   2. RETURNs the per-batch reset total so the JS flusher can
--      increment lifetime_resets_total in observability.
--
-- The reset count is computed BEFORE the UPSERT runs (against a
-- pre-aggregated copy of the batch matched against the current
-- lifetime_counters state) — PG <18 has no OLD alias inside the
-- INSERT ... ON CONFLICT ... RETURNING, so post-update RETURNING
-- can't see the pre-update value.

DROP FUNCTION IF EXISTS device_em.fn_upsert_lifetime(
    INT[], SMALLINT[], VARCHAR(30)[], NUMERIC[], BIGINT[]
);

CREATE OR REPLACE FUNCTION device_em.fn_upsert_lifetime(
    p_device INT[],
    p_channel SMALLINT[],
    p_tag VARCHAR(30)[],
    p_cumulative NUMERIC[],
    p_ts BIGINT[]
)
RETURNS INT
AS $$
DECLARE
    v_resets INT;
BEGIN
    -- Count resets using the same "latest per (device, channel, tag)"
    -- shape the UPSERT itself uses, so multiple rows for the same key
    -- in one batch don't double-count.
    WITH latest AS (
        SELECT DISTINCT ON (u.device, u.channel, u.tag)
            u.device, u.channel, u.tag, u.cumulative
        FROM unnest(p_device, p_channel, p_tag, p_cumulative, p_ts)
            AS u(device, channel, tag, cumulative, _ts)
        ORDER BY u.device, u.channel, u.tag, u._ts DESC
    )
    SELECT COALESCE(COUNT(*), 0)::INT INTO v_resets
    FROM latest l
    JOIN device_em.lifetime_counters c
        ON c.device = l.device
       AND c.channel = l.channel
       AND c.tag = l.tag
    WHERE l.cumulative < c.last_value_wh;

    WITH latest_per_key AS (
        SELECT DISTINCT ON (u.device, u.channel, u.tag)
            u.device,
            u.channel,
            u.tag,
            u.cumulative AS last_value_wh,
            to_timestamp(u._ts) AS seen_at
        FROM unnest(p_device, p_channel, p_tag, p_cumulative, p_ts)
            AS u(device, channel, tag, cumulative, _ts)
        ORDER BY u.device, u.channel, u.tag, u._ts DESC
    )
    INSERT INTO device_em.lifetime_counters (
        device, channel, tag, last_value_wh, lifetime_offset_wh,
        last_seen_ts, last_reset_ts, reset_count
    )
    SELECT
        device, channel, tag, last_value_wh, 0, seen_at, NULL, 0
    FROM latest_per_key
    ON CONFLICT (device, channel, tag) DO UPDATE SET
        last_value_wh = EXCLUDED.last_value_wh,
        lifetime_offset_wh = device_em.lifetime_counters.lifetime_offset_wh
            + CASE
                WHEN EXCLUDED.last_value_wh < device_em.lifetime_counters.last_value_wh
                THEN device_em.lifetime_counters.last_value_wh
                ELSE 0
              END,
        last_seen_ts = EXCLUDED.last_seen_ts,
        last_reset_ts = CASE
            WHEN EXCLUDED.last_value_wh < device_em.lifetime_counters.last_value_wh
            THEN EXCLUDED.last_seen_ts
            ELSE device_em.lifetime_counters.last_reset_ts
          END,
        reset_count = device_em.lifetime_counters.reset_count
            + CASE
                WHEN EXCLUDED.last_value_wh < device_em.lifetime_counters.last_value_wh
                THEN 1
                ELSE 0
              END;

    RETURN COALESCE(v_resets, 0);
END;
$$
LANGUAGE plpgsql;
--------------DOWN
SELECT 1;
