--------------UP
-- Completeness of an EM meter's stored minute records, without live rows.
--   Minute scan: every minute is a stored record or a device gap; any other
--   range is stored exactly and stays open until its records arrive.
--   Counter check: the meter's lifetime counter (device.status, written by the
--   status pipeline) changes by the stored minute energy between two observed
--   counter points, within a tolerance.
-- Billing reads open ranges through fn_em_incomplete_ranges and shows them as
-- incomplete, never as zero. Run per channel by the leader, not per message.
SET search_path TO device_em, public;

CREATE TABLE IF NOT EXISTS device_em.em_incomplete_range (
    id          BIGSERIAL PRIMARY KEY,
    device      INT NOT NULL,
    channel     INT NOT NULL,
    kind        VARCHAR(24) NOT NULL
                CHECK (kind IN ('missing_records', 'counter_mismatch')),
    tag         VARCHAR(30) NOT NULL,
    range_from  TIMESTAMP WITH TIME ZONE NOT NULL,
    range_to    TIMESTAMP WITH TIME ZONE NOT NULL,
    expected_wh DOUBLE PRECISION,
    stored_wh   DOUBLE PRECISION,
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    CHECK (range_to > range_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS em_incomplete_range_open
    ON device_em.em_incomplete_range (device, channel, kind, tag, range_from)
    WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS em_incomplete_range_device_time
    ON device_em.em_incomplete_range (device, range_from, range_to)
    WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS device_em.em_completeness_state (
    device             INT NOT NULL,
    channel            INT NOT NULL,
    scanned_to         TIMESTAMP WITH TIME ZONE NOT NULL,
    counter_checked_to TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (device, channel)
);

-- Lifetime counter fields of one channel, as the status pipeline names them:
-- EMData (triphase em:N) and EM1Data (em1:N).
CREATE OR REPLACE FUNCTION device_em.fn_em_counter_fields(p_channel INT)
RETURNS TABLE (tag VARCHAR(30), field TEXT)
LANGUAGE sql
IMMUTABLE
AS $$
    VALUES ('total_act_energy'::VARCHAR(30), format('emdata:%s.total_act', p_channel)),
           ('total_act_energy'::VARCHAR(30), format('em1data:%s.total_act_energy', p_channel)),
           ('total_act_ret_energy'::VARCHAR(30), format('emdata:%s.total_act_ret', p_channel)),
           ('total_act_ret_energy'::VARCHAR(30), format('em1data:%s.total_act_ret_energy', p_channel));
$$;

-- Re-checks the channel's open missing ranges: a filled range is resolved, a
-- partly filled one is replaced by what is still missing.
CREATE OR REPLACE FUNCTION device_em.fn_em_recheck_missing(
    p_device  INT,
    p_channel INT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_open RECORD;
    v_whole tstzmultirange;
    v_left  tstzmultirange;
BEGIN
    FOR v_open IN
        SELECT r.id, r.range_from, r.range_to
          FROM device_em.em_incomplete_range r
         WHERE r.device = p_device
           AND r.channel = p_channel
           AND r.kind = 'missing_records'
           AND r.resolved_at IS NULL
         ORDER BY r.range_from
    LOOP
        v_whole := tstzmultirange(tstzrange(v_open.range_from, v_open.range_to));
        v_left := v_whole - device_em.fn_em_record_coverage(
            p_device, p_channel, v_open.range_from, v_open.range_to);
        CONTINUE WHEN v_left = v_whole;
        UPDATE device_em.em_incomplete_range
           SET resolved_at = now()
         WHERE id = v_open.id;
        INSERT INTO device_em.em_incomplete_range
            (device, channel, kind, tag, range_from, range_to)
        SELECT p_device, p_channel, 'missing_records', 'total_act_energy',
               lower(piece), upper(piece)
          FROM unnest(v_left) AS piece
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

-- Scans [scanned_to, horizon) for ranges with neither a record nor a device
-- gap. The horizon is the earlier of p_until and the end of the last stored
-- record, so a meter that has not been read yet is not reported as missing.
-- The first scan of a channel only sets its start.
CREATE OR REPLACE FUNCTION device_em.fn_em_scan_missing(
    p_device   INT,
    p_channel  INT,
    p_until    TIMESTAMP WITH TIME ZONE,
    p_max_span INTERVAL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_from    TIMESTAMP WITH TIME ZONE;
    v_last    TIMESTAMP WITH TIME ZONE;
    v_horizon TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT s.scanned_to INTO v_from
      FROM device_em.em_completeness_state s
     WHERE s.device = p_device AND s.channel = p_channel
       FOR UPDATE;
    SELECT max(st.ts + make_interval(secs => st.sample_period)) INTO v_last
      FROM device_em.stats st
     WHERE st.device = p_device
       AND st.channel = p_channel
       AND st.tag = 'total_act_energy'
       AND st.source = 'em_sync'
       AND st.sample_period IS NOT NULL
       AND st.ts >= COALESCE(v_from, p_until - p_max_span)
       AND st.ts < p_until;
    v_horizon := LEAST(p_until, COALESCE(v_last, p_until));
    IF v_from IS NULL THEN
        INSERT INTO device_em.em_completeness_state (device, channel, scanned_to)
        VALUES (p_device, p_channel, v_horizon);
        RETURN;
    END IF;
    IF v_last IS NULL THEN
        RETURN;
    END IF;
    v_horizon := LEAST(v_horizon, v_from + p_max_span);
    IF v_horizon <= v_from THEN
        RETURN;
    END IF;
    INSERT INTO device_em.em_incomplete_range
        (device, channel, kind, tag, range_from, range_to)
    SELECT p_device, p_channel, 'missing_records', 'total_act_energy',
           lower(piece), upper(piece)
      FROM unnest(
               tstzmultirange(tstzrange(v_from, v_horizon))
               - device_em.fn_em_record_coverage(
                     p_device, p_channel, v_from, v_horizon)
           ) AS piece
    ON CONFLICT DO NOTHING;
    UPDATE device_em.em_completeness_state
       SET scanned_to = v_horizon
     WHERE device = p_device AND channel = p_channel;
END;
$$;

-- Compares the counter change between the first and last counter point of
-- the window with the stored minute energy between them. Records crossing a
-- counter point may hold part of the change, so they widen the accepted band
-- instead of counting either way.
CREATE OR REPLACE FUNCTION device_em.fn_em_check_counters(
    p_device        INT,
    p_channel       INT,
    p_until         TIMESTAMP WITH TIME ZONE,
    p_lookback      INTERVAL,
    p_tolerance_pct DOUBLE PRECISION
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_since   TIMESTAMP WITH TIME ZONE;
    v_until   TIMESTAMP WITH TIME ZONE;
    v_last    TIMESTAMP WITH TIME ZONE;
    v_checked TIMESTAMP WITH TIME ZONE;
    v_counter RECORD;
BEGIN
    SELECT GREATEST(s.counter_checked_to, p_until - p_lookback) INTO v_since
      FROM device_em.em_completeness_state s
     WHERE s.device = p_device AND s.channel = p_channel
       FOR UPDATE;
    v_since := COALESCE(v_since, p_until - p_lookback);
    SELECT max(st.ts + make_interval(secs => st.sample_period)) INTO v_last
      FROM device_em.stats st
     WHERE st.device = p_device
       AND st.channel = p_channel
       AND st.tag = 'total_act_energy'
       AND st.source = 'em_sync'
       AND st.sample_period IS NOT NULL
       AND st.ts >= v_since - INTERVAL '1 hour'
       AND st.ts < p_until;
    IF v_last IS NULL THEN
        RETURN;
    END IF;
    v_until := LEAST(p_until, v_last);
    FOR v_counter IN
        WITH points AS (
            SELECT f.tag, st.ts, st.value::DOUBLE PRECISION AS wh
              FROM device_em.fn_em_counter_fields(p_channel) f
              JOIN device.status st
                ON st.id = p_device
               AND st.field = f.field
               AND st.ts >= v_since
               AND st.ts <= v_until
        ),
        ends AS (
            SELECT p.tag,
                   (array_agg(p.ts ORDER BY p.ts))[1] AS t1,
                   (array_agg(p.wh ORDER BY p.ts))[1] AS v1,
                   (array_agg(p.ts ORDER BY p.ts DESC))[1] AS t2,
                   (array_agg(p.wh ORDER BY p.ts DESC))[1] AS v2
              FROM points p
             GROUP BY p.tag
        )
        SELECT e.tag, e.t1, e.t2, e.v2 - e.v1 AS delta,
               COALESCE(SUM(r.val) FILTER (
                   WHERE r.ts >= e.t1
                     AND r.ts + make_interval(secs => r.sample_period) <= e.t2
               ), 0) AS inside,
               COALESCE(SUM(r.val) FILTER (
                   WHERE (r.ts < e.t1 AND r.ts + make_interval(secs => r.sample_period) > e.t1)
                      OR (r.ts < e.t2 AND r.ts + make_interval(secs => r.sample_period) > e.t2)
               ), 0) AS edges
          FROM ends e
          LEFT JOIN device_em.stats r
            ON r.device = p_device
           AND r.channel = p_channel
           AND r.tag = e.tag
           AND r.source = 'em_sync'
           AND r.sample_period IS NOT NULL
           AND r.ts >= e.t1 - INTERVAL '1 hour'
           AND r.ts < e.t2
         WHERE e.t2 > e.t1
         GROUP BY e.tag, e.t1, e.t2, e.v1, e.v2
    LOOP
        v_checked := GREATEST(COALESCE(v_checked, v_counter.t2), v_counter.t2);
        -- A counter that went down was reset; there is nothing to compare.
        CONTINUE WHEN v_counter.delta < 0;
        CONTINUE WHEN v_counter.delta >= v_counter.inside
                      - p_tolerance_pct / 100 * GREATEST(v_counter.delta, v_counter.inside)
                  AND v_counter.delta <= v_counter.inside + v_counter.edges
                      + p_tolerance_pct / 100 * GREATEST(v_counter.delta, v_counter.inside);
        INSERT INTO device_em.em_incomplete_range
            (device, channel, kind, tag, range_from, range_to, expected_wh, stored_wh)
        VALUES (p_device, p_channel, 'counter_mismatch', v_counter.tag,
                v_counter.t1, v_counter.t2, v_counter.delta, v_counter.inside)
        ON CONFLICT DO NOTHING;
    END LOOP;
    IF v_checked IS NOT NULL THEN
        UPDATE device_em.em_completeness_state
           SET counter_checked_to = v_checked
         WHERE device = p_device AND channel = p_channel;
    END IF;
END;
$$;

-- One completeness pass for one channel. Returns the ranges it newly found.
CREATE OR REPLACE FUNCTION device_em.fn_em_completeness_check(
    p_device        INT,
    p_channel       INT,
    p_now           TIMESTAMP WITH TIME ZONE,
    p_settle        INTERVAL,
    p_max_span      INTERVAL,
    p_lookback      INTERVAL,
    p_tolerance_pct DOUBLE PRECISION
)
RETURNS TABLE (
    kind        VARCHAR(24),
    tag         VARCHAR(30),
    range_from  TIMESTAMP WITH TIME ZONE,
    range_to    TIMESTAMP WITH TIME ZONE,
    expected_wh DOUBLE PRECISION,
    stored_wh   DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
DECLARE
    -- detected_at and resolved_at default to the transaction time.
    v_started TIMESTAMP WITH TIME ZONE := now();
BEGIN
    PERFORM device_em.fn_em_recheck_missing(p_device, p_channel);
    PERFORM device_em.fn_em_scan_missing(
        p_device, p_channel, p_now - p_settle, p_max_span);
    PERFORM device_em.fn_em_check_counters(
        p_device, p_channel, p_now - p_settle, p_lookback, p_tolerance_pct);
    RETURN QUERY
    SELECT r.kind, r.tag, r.range_from, r.range_to, r.expected_wh, r.stored_wh
      FROM device_em.em_incomplete_range r
     WHERE r.device = p_device
       AND r.channel = p_channel
       AND r.resolved_at IS NULL
       AND r.detected_at >= v_started
       AND NOT EXISTS (
           -- A still-missing remainder of a range found earlier is not new.
           SELECT 1
             FROM device_em.em_incomplete_range old
            WHERE old.device = r.device
              AND old.channel = r.channel
              AND old.kind = r.kind
              AND old.resolved_at >= v_started
              AND tstzrange(old.range_from, old.range_to)
                  @> tstzrange(r.range_from, r.range_to)
       )
     ORDER BY r.range_from;
END;
$$;

-- Open incomplete ranges of the devices overlapping [p_from, p_to). A billing
-- or report read shows these as incomplete, never as zero consumption.
CREATE OR REPLACE FUNCTION device_em.fn_em_incomplete_ranges(
    p_devices INT[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
    device      INT,
    channel     INT,
    kind        VARCHAR(24),
    tag         VARCHAR(30),
    range_from  TIMESTAMP WITH TIME ZONE,
    range_to    TIMESTAMP WITH TIME ZONE,
    expected_wh DOUBLE PRECISION,
    stored_wh   DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    SELECT r.device, r.channel, r.kind, r.tag, r.range_from, r.range_to,
           r.expected_wh, r.stored_wh
      FROM device_em.em_incomplete_range r
     WHERE r.device = ANY(p_devices)
       AND r.resolved_at IS NULL
       AND r.range_from < p_to
       AND r.range_to > p_from
     ORDER BY r.device, r.range_from;
$$;

-- The earliest open missing range below each channel's complete-up-to: the
-- bookmark already passed it, so only an explicit gap-fill pull reaches it.
CREATE OR REPLACE FUNCTION device_em.fn_em_sync_open_holes(p_devices INT[])
RETURNS TABLE (
    device    INT,
    channel   INT,
    hole_from BIGINT,
    hole_to   BIGINT
)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT ON (r.device, r.channel)
           r.device, r.channel,
           EXTRACT(EPOCH FROM r.range_from)::BIGINT,
           EXTRACT(EPOCH FROM r.range_to)::BIGINT
      FROM device_em.em_incomplete_range r
      JOIN device_em.sync s
        ON s.device = r.device
       AND s.channel = r.channel
     WHERE r.device = ANY(p_devices)
       AND r.kind = 'missing_records'
       AND r.resolved_at IS NULL
       AND r.range_to <= to_timestamp(s.created)
     ORDER BY r.device, r.channel, r.range_from;
$$;

-- Channels the check walks: every channel with a sync bookmark.
CREATE OR REPLACE FUNCTION device_em.fn_em_completeness_channels()
RETURNS TABLE (device INT, channel INT)
LANGUAGE sql
STABLE
AS $$
    SELECT s.device, s.channel
      FROM device_em.sync s
     WHERE s.channel IS NOT NULL
     ORDER BY s.device, s.channel;
$$;
--------------DOWN
SET search_path TO device_em, public;
DROP FUNCTION IF EXISTS device_em.fn_em_completeness_channels();
DROP FUNCTION IF EXISTS device_em.fn_em_sync_open_holes(INT[]);
DROP FUNCTION IF EXISTS device_em.fn_em_incomplete_ranges(
    INT[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
DROP FUNCTION IF EXISTS device_em.fn_em_completeness_check(
    INT, INT, TIMESTAMP WITH TIME ZONE, INTERVAL, INTERVAL, INTERVAL,
    DOUBLE PRECISION);
DROP FUNCTION IF EXISTS device_em.fn_em_check_counters(
    INT, INT, TIMESTAMP WITH TIME ZONE, INTERVAL, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS device_em.fn_em_scan_missing(
    INT, INT, TIMESTAMP WITH TIME ZONE, INTERVAL);
DROP FUNCTION IF EXISTS device_em.fn_em_recheck_missing(INT, INT);
DROP FUNCTION IF EXISTS device_em.fn_em_counter_fields(INT);
DROP TABLE IF EXISTS device_em.em_completeness_state;
DROP TABLE IF EXISTS device_em.em_incomplete_range;
