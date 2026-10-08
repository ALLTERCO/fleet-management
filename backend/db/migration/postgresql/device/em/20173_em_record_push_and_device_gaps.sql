--------------UP
-- The meter's own 1-minute records arrive two ways: pushed by the device each
-- minute and pulled (GetData) to fill holes. Both routes write through one
-- function, so a minute delivered twice is stored once, and the bookmark is
-- "complete up to": it moves only through contiguous minutes or through ranges
-- the device itself reported as having no record.
SET search_path TO device_em, public;

-- Ranges a GetData answer showed the device has no record for (power loss,
-- history it no longer keeps, a record with no usable energy). Stored once so
-- the range is never pulled again and never reported as missing.
CREATE TABLE IF NOT EXISTS device_em.em_device_gap (
    device      INT NOT NULL,
    channel     INT NOT NULL,
    gap_from    TIMESTAMP WITH TIME ZONE NOT NULL,
    gap_to      TIMESTAMP WITH TIME ZONE NOT NULL,
    reported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    PRIMARY KEY (device, channel, gap_from),
    CHECK (gap_to > gap_from)
);

-- Time one channel is accounted for between p_from and p_to: each stored
-- energy record over its own period, plus every device gap. One definition for
-- the bookmark walk and the completeness scan.
CREATE OR REPLACE FUNCTION device_em.fn_em_record_coverage(
    p_device  INT,
    p_channel INT,
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE
)
RETURNS tstzmultirange
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(range_agg(parts.r), '{}'::tstzmultirange)
      FROM (
          SELECT tstzrange(st.ts, st.ts + make_interval(secs => st.sample_period)) AS r
            FROM device_em.stats st
           WHERE st.device = p_device
             AND st.channel = p_channel
             AND st.tag = 'total_act_energy'
             AND st.source = 'em_sync'
             AND st.sample_period IS NOT NULL
             -- A record starting up to an hour earlier can still cover p_from.
             AND st.ts >= p_from - INTERVAL '1 hour'
             AND st.ts < p_to
          UNION ALL
          SELECT tstzrange(g.gap_from, g.gap_to)
            FROM device_em.em_device_gap g
           WHERE g.device = p_device
             AND g.channel = p_channel
             AND g.gap_to > p_from
             AND g.gap_from < p_to
      ) parts;
$$;

-- Moves the bookmark of one channel over every minute that is now covered,
-- starting at the bookmark. Bounded to one day ahead per call; the next write
-- continues from there.
CREATE OR REPLACE FUNCTION device_em.fn_em_sync_advance(
    p_device  INT,
    p_channel INT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_created BIGINT;
    v_from    TIMESTAMP WITH TIME ZONE;
    v_reached TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT s.created INTO v_created
      FROM device_em.sync s
     WHERE s.device = p_device
       AND s.channel IS NOT DISTINCT FROM p_channel
       FOR UPDATE;
    IF v_created IS NULL THEN
        RETURN NULL;
    END IF;
    v_from := to_timestamp(v_created);
    SELECT upper(piece) INTO v_reached
      FROM unnest(device_em.fn_em_record_coverage(
               p_device, p_channel, v_from, v_from + INTERVAL '1 day')) AS piece
     WHERE piece @> v_from;
    IF v_reached IS NOT NULL AND v_reached > v_from THEN
        v_created := EXTRACT(EPOCH FROM v_reached)::BIGINT;
        UPDATE device_em.sync
           SET created = v_created
         WHERE device = p_device
           AND channel IS NOT DISTINCT FROM p_channel;
    END IF;
    RETURN v_created;
END;
$$;

-- v2 plus: a minute already stored from the other route is skipped (stored
-- once); device gaps are stored with the rows; every touched channel's
-- bookmark then advances through contiguous coverage. Pull cursors (p_sync_*)
-- still move the bookmark forward as before: a pull's range is either stored
-- or reported in p_gap_*. Pushed records carry no cursor.
CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch_v3(
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
    p_period        INT[],
    p_gap_device    INT[],
    p_gap_channel   INT[],
    p_gap_from      BIGINT[],
    p_gap_to        BIGINT[]
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count BIGINT;
    v_key   RECORD;
BEGIN
    IF p_period IS NOT NULL AND (
        cardinality(p_period) <> cardinality(p_ts)
        OR EXISTS (SELECT 1 FROM unnest(p_period) p WHERE p <= 0)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EM_SYNC_PERIOD_INVALID';
    END IF;
    IF cardinality(p_gap_device) IS DISTINCT FROM cardinality(p_gap_channel)
       OR cardinality(p_gap_device) IS DISTINCT FROM cardinality(p_gap_from)
       OR cardinality(p_gap_device) IS DISTINCT FROM cardinality(p_gap_to)
       OR EXISTS (
           SELECT 1 FROM unnest(p_gap_from, p_gap_to) AS g(gap_from, gap_to)
            WHERE g.gap_to <= g.gap_from
       ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EM_SYNC_GAP_INVALID';
    END IF;

    WITH ins AS MATERIALIZED (
        INSERT INTO device_em.stats
            (device, tag, domain, phase, channel, ts, val, source, sample_period)
        SELECT DISTINCT ON
               (u.device, u.tag, u.domain, u.phase, u.channel, u._ts)
               u.device, u.tag, u.domain, u.phase, u.channel,
               to_timestamp(u._ts), u.val, p_source, u.period
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val, p_period)
             AS u(device, tag, domain, phase, channel, _ts, val, period)
        WHERE NOT EXISTS (
            SELECT 1
              FROM device_em.stats s
             WHERE s.device = u.device
               AND s.tag = u.tag
               AND s.domain = u.domain
               AND s.phase IS NOT DISTINCT FROM u.phase
               AND s.channel IS NOT DISTINCT FROM u.channel
               AND s.ts = to_timestamp(u._ts)
               AND s.source = p_source
        )
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

    INSERT INTO device_em.em_device_gap (device, channel, gap_from, gap_to)
    SELECT g.device, g.channel, to_timestamp(g.gap_from), to_timestamp(max(g.gap_to))
      FROM unnest(p_gap_device, p_gap_channel, p_gap_from, p_gap_to)
           AS g(device, channel, gap_from, gap_to)
     GROUP BY g.device, g.channel, g.gap_from
     ORDER BY 1, 2, 3
    ON CONFLICT (device, channel, gap_from)
    DO UPDATE SET gap_to = GREATEST(device_em.em_device_gap.gap_to, EXCLUDED.gap_to);

    FOR v_key IN
        SELECT DISTINCT k.device, k.channel
          FROM (
              SELECT u.device, u.channel::INT AS channel
                FROM unnest(p_device, p_channel) AS u(device, channel)
              UNION
              SELECT u.device, u.channel
                FROM unnest(p_sync_device, p_sync_channel) AS u(device, channel)
              UNION
              SELECT u.device, u.channel
                FROM unnest(p_gap_device, p_gap_channel) AS u(device, channel)
          ) k
         ORDER BY 1, 2
    LOOP
        PERFORM device_em.fn_em_sync_advance(v_key.device, v_key.channel);
    END LOOP;
    RETURN v_count;
END;
$$;

-- Per channel: the bookmark and the first stored record after it, so a pull
-- asks only for the hole between them.
CREATE OR REPLACE FUNCTION device_em.fn_em_sync_positions(p_devices INT[])
RETURNS TABLE (
    device      INT,
    channel     INT,
    created     BIGINT,
    next_stored BIGINT
)
LANGUAGE sql
STABLE
AS $$
    SELECT s.device, s.channel, s.created,
           (
               SELECT EXTRACT(EPOCH FROM min(st.ts))::BIGINT
                 FROM device_em.stats st
                WHERE st.device = s.device
                  AND st.channel = s.channel
                  AND st.tag = 'total_act_energy'
                  AND st.source = 'em_sync'
                  AND st.ts > to_timestamp(s.created)
                  AND st.ts < to_timestamp(s.created) + INTERVAL '1 day'
           )
      FROM device_em.sync s
     WHERE s.device = ANY(p_devices)
       AND s.channel IS NOT NULL
     ORDER BY s.device, s.channel;
$$;
--------------DOWN
SET search_path TO device_em, public;
DROP FUNCTION IF EXISTS device_em.fn_em_sync_positions(INT[]);
DROP FUNCTION IF EXISTS device_em.fn_append_stats_synced_batch_v3(
    INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[],
    REAL[], VARCHAR(16), INT[], BIGINT[], INT[], INT[], INT[], INT[],
    BIGINT[], BIGINT[]);
DROP FUNCTION IF EXISTS device_em.fn_em_sync_advance(INT, INT);
DROP FUNCTION IF EXISTS device_em.fn_em_record_coverage(
    INT, INT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
DROP TABLE IF EXISTS device_em.em_device_gap;
