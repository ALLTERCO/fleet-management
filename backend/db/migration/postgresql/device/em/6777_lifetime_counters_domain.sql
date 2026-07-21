--------------UP
-- bm charge_ah/discharge_ah are delta tags, so their cumulative lands in
-- device_em.lifetime_counters — a table whose value column is Wh-named and
-- whose identity is (device, channel, tag). A dc_battery Ah counter and an
-- ac_mains Wh counter can share the same (channel, tag), so domain becomes part
-- of the identity: add the column (default ac_mains for every existing AC row)
-- and widen the primary key. The value column keeps its Wh name but now holds
-- the tag's native unit (Wh for energy, Ah for battery charge/discharge).

ALTER TABLE device_em.lifetime_counters
    ADD COLUMN IF NOT EXISTS domain VARCHAR(16) NOT NULL DEFAULT 'ac_mains';

ALTER TABLE device_em.lifetime_counters
    DROP CONSTRAINT IF EXISTS lifetime_counters_pkey;
ALTER TABLE device_em.lifetime_counters
    ADD PRIMARY KEY (device, channel, tag, domain);

COMMENT ON COLUMN device_em.lifetime_counters.last_value_wh IS
    'Most recent absolute reading from the device, in the tag''s native unit (Wh for energy, Ah for bm charge/discharge). Name kept for compatibility.';
COMMENT ON COLUMN device_em.lifetime_counters.domain IS
    'Electrical domain (ac_mains / dc_battery / …). Part of the identity so Ah (DC) and Wh (AC) counters coexist on the same channel/tag.';

-- Re-create fn_upsert_lifetime with the domain array threaded through the reset
-- detection, the UPSERT key, and the ON CONFLICT target. Return type unchanged
-- (per-batch reset count), so the JS flusher is untouched.
DROP FUNCTION IF EXISTS device_em.fn_upsert_lifetime(
    INT[], SMALLINT[], VARCHAR(30)[], NUMERIC[], BIGINT[]
);

CREATE FUNCTION device_em.fn_upsert_lifetime(
    p_device INT[],
    p_channel SMALLINT[],
    p_tag VARCHAR(30)[],
    p_cumulative NUMERIC[],
    p_ts BIGINT[],
    p_domain VARCHAR(16)[]
)
RETURNS INT
AS $$
DECLARE
    v_resets INT;
BEGIN
    WITH latest AS (
        SELECT DISTINCT ON (u.device, u.channel, u.tag, u.domain)
            u.device, u.channel, u.tag, u.domain, u.cumulative
        FROM unnest(p_device, p_channel, p_tag, p_cumulative, p_ts, p_domain)
            AS u(device, channel, tag, cumulative, _ts, domain)
        ORDER BY u.device, u.channel, u.tag, u.domain, u._ts DESC
    )
    SELECT COALESCE(COUNT(*), 0)::INT INTO v_resets
    FROM latest l
    JOIN device_em.lifetime_counters c
        ON c.device = l.device
       AND c.channel = l.channel
       AND c.tag = l.tag
       AND c.domain = l.domain
    WHERE l.cumulative < c.last_value_wh;

    WITH latest_per_key AS (
        SELECT DISTINCT ON (u.device, u.channel, u.tag, u.domain)
            u.device,
            u.channel,
            u.tag,
            u.domain,
            u.cumulative AS last_value_wh,
            to_timestamp(u._ts) AS seen_at
        FROM unnest(p_device, p_channel, p_tag, p_cumulative, p_ts, p_domain)
            AS u(device, channel, tag, cumulative, _ts, domain)
        ORDER BY u.device, u.channel, u.tag, u.domain, u._ts DESC
    )
    INSERT INTO device_em.lifetime_counters (
        device, channel, tag, domain, last_value_wh, lifetime_offset_wh,
        last_seen_ts, last_reset_ts, reset_count
    )
    SELECT
        device, channel, tag, domain, last_value_wh, 0, seen_at, NULL, 0
    FROM latest_per_key
    ON CONFLICT (device, channel, tag, domain) DO UPDATE SET
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
-- Restore the 6711 domain-blind function and the (device, channel, tag) key.
DROP FUNCTION IF EXISTS device_em.fn_upsert_lifetime(
    INT[], SMALLINT[], VARCHAR(30)[], NUMERIC[], BIGINT[], VARCHAR(16)[]
);

CREATE FUNCTION device_em.fn_upsert_lifetime(
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

ALTER TABLE device_em.lifetime_counters
    DROP CONSTRAINT IF EXISTS lifetime_counters_pkey;
ALTER TABLE device_em.lifetime_counters
    DROP COLUMN IF EXISTS domain;
ALTER TABLE device_em.lifetime_counters
    ADD PRIMARY KEY (device, channel, tag);
