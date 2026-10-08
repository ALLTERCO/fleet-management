-- EM record ingest without reading stored history (v5). Each meter channel's
-- sync row keeps the time its stored records cover (recorded). A write locks
-- its channels' rows in one order, stores only records not covered yet, and
-- publishes the new coverage and complete-up-to watermark in the same
-- transaction, so a record is stored once and no write reads device_em.stats.
-- The watermark moves only through coverage and device gaps, never by a pull
-- cursor. created is NULL for a channel written before its bookmark is seeded.
-- Coverage of existing channels is built once from stats: lazily by the first
-- write, and in batches by fn_em_coverage_bootstrap. v4 stays for rollback and
-- clears the coverage it bypasses, so v5 rebuilds it.
-- Design: report/local-ci/architecture-review-2026-10-07/em-ingest-cost-design.md.
-- Decision: docs/internal/decisions/em-record-ingest-incremental-coverage.md.
--------------UP
SET search_path TO device_em, public;

ALTER TABLE device_em.sync ADD COLUMN IF NOT EXISTS recorded tstzmultirange;
ALTER TABLE device_em.sync ALTER COLUMN created DROP NOT NULL;
-- Free space on each page keeps the per-write row update HOT.
ALTER TABLE device_em.sync SET (fillfactor = 70);

-- The time one stored record covers. A row without a period is keyed by its
-- instant, so a re-delivery of it is still recognised.
CREATE OR REPLACE FUNCTION device_em.fn_em_record_span(
    p_ts     TIMESTAMPTZ,
    p_period INT
)
RETURNS tstzrange
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT CASE WHEN p_period IS NULL
                THEN tstzrange(p_ts, p_ts, '[]')
                ELSE tstzrange(p_ts, p_ts + make_interval(secs => p_period))
           END;
$$;

-- Coverage is exact from here on: below it a record is either too old to
-- store (older than retention and behind the watermark) or already trimmed.
CREATE OR REPLACE FUNCTION device_em.fn_em_coverage_floor(
    p_created BIGINT,
    p_horizon TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE WHEN p_created IS NULL OR p_horizon IS NULL
                THEN '-infinity'::TIMESTAMPTZ
                ELSE LEAST(p_horizon, to_timestamp(p_created))
           END;
$$;

-- Coverage rebuilt from stored energy records; the one-time bootstrap source.
CREATE OR REPLACE FUNCTION device_em.fn_em_stats_coverage(
    p_device  INT,
    p_channel INT,
    p_from    TIMESTAMPTZ
)
RETURNS tstzmultirange
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
               range_agg(tstzrange(st.ts, st.ts + make_interval(secs => st.sample_period))),
               '{}'::tstzmultirange)
      FROM device_em.stats st
     WHERE st.device = p_device
       AND st.channel = p_channel
       AND st.tag = 'total_act_energy'
       AND st.source = 'em_sync'
       AND st.sample_period IS NOT NULL
       -- A record starting up to an hour earlier can still cover p_from.
       AND st.ts >= p_from - INTERVAL '1 hour';
$$;

-- Builds coverage for up to p_limit channels that have none yet. Resumable:
-- a built row is never picked again, a row a writer holds is skipped (the
-- writer builds it itself). Returns how many rows it built.
CREATE OR REPLACE FUNCTION device_em.fn_em_coverage_bootstrap(p_limit INT DEFAULT 100)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_horizon TIMESTAMPTZ := device_em.fn_stats_retention_horizon();
    v_row     RECORD;
    v_built   INT := 0;
BEGIN
    FOR v_row IN
        SELECT s.device, s.channel, s.created
          FROM device_em.sync s
         WHERE s.recorded IS NULL
           AND s.channel IS NOT NULL
         ORDER BY s.device, s.channel
         LIMIT GREATEST(1, p_limit)
           FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE device_em.sync
           SET recorded = device_em.fn_em_stats_coverage(
                   v_row.device, v_row.channel,
                   device_em.fn_em_coverage_floor(v_row.created, v_horizon))
         WHERE device = v_row.device
           AND channel = v_row.channel;
        v_built := v_built + 1;
    END LOOP;
    RETURN v_built;
END;
$$;

-- Time one channel is accounted for in [p_from, p_to): stored records plus
-- device gaps. Reads the channel's coverage; reads stats only where coverage
-- is not built or not exact.
CREATE OR REPLACE FUNCTION device_em.fn_em_channel_coverage(
    p_device  INT,
    p_channel INT,
    p_from    TIMESTAMPTZ,
    p_to      TIMESTAMPTZ
)
RETURNS tstzmultirange
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_window   tstzmultirange := tstzmultirange(tstzrange(p_from, p_to));
    v_recorded tstzmultirange;
    v_created  BIGINT;
BEGIN
    SELECT s.recorded, s.created INTO v_recorded, v_created
      FROM device_em.sync s
     WHERE s.device = p_device
       AND s.channel = p_channel;
    IF v_recorded IS NULL
       OR p_from < device_em.fn_em_coverage_floor(
              v_created, device_em.fn_stats_retention_horizon()) THEN
        RETURN device_em.fn_em_record_coverage(p_device, p_channel, p_from, p_to)
               * v_window;
    END IF;
    RETURN (v_recorded + COALESCE((
               SELECT range_agg(tstzrange(g.gap_from, g.gap_to))
                 FROM device_em.em_device_gap g
                WHERE g.device = p_device
                  AND g.channel = p_channel
                  AND g.gap_to > p_from
                  AND g.gap_from < p_to
           ), '{}'::tstzmultirange)) * v_window;
END;
$$;

-- v4 rules on the channel's stored coverage instead of stored rows:
-- S1 lock the batch's channel rows in (device, channel) order, building a
-- missing coverage once; S2 store rows whose record is not covered yet; S4
-- store device gaps; S5 publish coverage and the watermark (the end of the
-- accounted range holding it); S3 schedule rollup keys, due at once when the
-- new watermark already passed their bucket; S6 make the channels' other
-- scheduled keys due in the blocks the watermark crossed. First writer wins on conflicting
-- values. Pull cursors (p_sync_*) only name channels; they move nothing.
CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch_v5(
    p_device           INT[],
    p_tag              VARCHAR(30)[],
    p_domain           VARCHAR(16)[],
    p_phase            VARCHAR(1)[],
    p_channel          SMALLINT[],
    p_ts               BIGINT[],
    p_val              REAL[],
    p_source           VARCHAR(16),
    p_sync_device      INT[],
    p_sync_created     BIGINT[],
    p_sync_channel     INT[],
    p_period           INT[],
    p_gap_device       INT[],
    p_gap_channel      INT[],
    p_gap_from         BIGINT[],
    p_gap_to           BIGINT[],
    p_close_grace_ms   INT,
    p_late_debounce_ms INT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_horizon     TIMESTAMPTZ := device_em.fn_stats_retention_horizon();
    v_want_device INT[];
    v_want_chan   INT[];
    v_dev         INT[];
    v_ch          INT[];
    v_created     BIGINT[];
    v_rec         tstzmultirange[];
    v_new_created BIGINT[];
    v_count       BIGINT;
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
    IF p_close_grace_ms IS NULL OR p_close_grace_ms < 0
       OR p_late_debounce_ms IS NULL OR p_late_debounce_ms < 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EM_ROLLUP_TIMING_INVALID';
    END IF;
    -- Coverage is per channel; a record without one has no row to lock.
    IF EXISTS (SELECT 1 FROM unnest(p_device, p_channel) AS u(device, channel)
                WHERE u.device IS NULL OR u.channel IS NULL)
       OR EXISTS (SELECT 1 FROM unnest(p_sync_device, p_sync_channel) AS u(device, channel)
                   WHERE u.device IS NULL OR u.channel IS NULL)
       OR EXISTS (SELECT 1 FROM unnest(p_gap_device, p_gap_channel) AS u(device, channel)
                   WHERE u.device IS NULL OR u.channel IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EM_SYNC_CHANNEL_INVALID';
    END IF;

    -- S1
    SELECT array_agg(k.device ORDER BY k.device, k.channel),
           array_agg(k.channel ORDER BY k.device, k.channel)
      INTO v_want_device, v_want_chan
      FROM (
          SELECT u.device, u.channel::INT AS channel
            FROM unnest(p_device, p_channel) AS u(device, channel)
          UNION
          SELECT u.device, u.channel
            FROM unnest(p_sync_device, p_sync_channel) AS u(device, channel)
          UNION
          SELECT u.device, u.channel
            FROM unnest(p_gap_device, p_gap_channel) AS u(device, channel)
      ) k;
    IF v_want_device IS NULL THEN
        RETURN 0;
    END IF;
    -- A row deleted between the insert and the lock (hardware replaced) is
    -- inserted again; once locked it stays.
    LOOP
        INSERT INTO device_em.sync (device, channel, created)
        SELECT k.device, k.channel, NULL
          FROM unnest(v_want_device, v_want_chan) AS k(device, channel)
         ORDER BY 1, 2
        ON CONFLICT (device, channel) DO NOTHING;
        SELECT array_agg(l.device ORDER BY l.device, l.channel),
               array_agg(l.channel ORDER BY l.device, l.channel),
               array_agg(l.created ORDER BY l.device, l.channel),
               array_agg(l.recorded ORDER BY l.device, l.channel)
          INTO v_dev, v_ch, v_created, v_rec
          FROM (
              SELECT s.device, s.channel, s.created, s.recorded
                FROM device_em.sync s
                JOIN unnest(v_want_device, v_want_chan) AS k(device, channel)
                  ON s.device = k.device
                 AND s.channel = k.channel
               ORDER BY s.device, s.channel
                 FOR UPDATE OF s
          ) l;
        EXIT WHEN cardinality(v_dev) = cardinality(v_want_device);
    END LOOP;
    FOR i IN 1 .. cardinality(v_dev) LOOP
        IF v_rec[i] IS NULL THEN
            v_rec[i] := device_em.fn_em_stats_coverage(
                v_dev[i], v_ch[i],
                device_em.fn_em_coverage_floor(v_created[i], v_horizon));
        END IF;
    END LOOP;

    -- S4
    INSERT INTO device_em.em_device_gap (device, channel, gap_from, gap_to)
    SELECT g.device, g.channel, to_timestamp(g.gap_from), to_timestamp(max(g.gap_to))
      FROM unnest(p_gap_device, p_gap_channel, p_gap_from, p_gap_to)
           AS g(device, channel, gap_from, gap_to)
     GROUP BY g.device, g.channel, g.gap_from
     ORDER BY 1, 2, 3
    ON CONFLICT (device, channel, gap_from)
    DO UPDATE SET gap_to = GREATEST(device_em.em_device_gap.gap_to, EXCLUDED.gap_to);

    -- S2, S5, S3
    WITH chan AS (
        SELECT c.device, c.channel, c.created, c.recorded
          FROM unnest(v_dev, v_ch, v_created, v_rec)
               AS c(device, channel, created, recorded)
    ),
    ins AS MATERIALIZED (
        INSERT INTO device_em.stats
            (device, tag, domain, phase, channel, ts, val, source, sample_period)
        SELECT DISTINCT ON
               (u.device, u.tag, u.domain, u.phase, u.channel, u._ts)
               u.device, u.tag, u.domain, u.phase, u.channel,
               to_timestamp(u._ts), u.val, p_source, u.period
          FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val, p_period)
               AS u(device, tag, domain, phase, channel, _ts, val, period)
          JOIN chan c
            ON c.device = u.device
           AND c.channel = u.channel
         WHERE NOT c.recorded @> device_em.fn_em_record_span(to_timestamp(u._ts), u.period)
           AND NOT COALESCE(to_timestamp(u._ts) < v_horizon AND c.created > u._ts, FALSE)
         ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts, u.val, u.period
        RETURNING device, tag, domain, phase, channel, ts, sample_period
    ),
    added AS (
        SELECT i.device, i.channel::INT AS channel,
               range_agg(device_em.fn_em_record_span(i.ts, i.sample_period)) AS span
          FROM ins i
         GROUP BY 1, 2
    ),
    cov AS (
        SELECT c.device, c.channel, c.created,
               c.recorded + COALESCE(a.span, '{}'::tstzmultirange) AS recorded
          FROM chan c
          LEFT JOIN added a
            ON a.device = c.device
           AND a.channel = c.channel
    ),
    mark AS MATERIALIZED (
        SELECT v.device, v.channel, v.created AS old_created, v.recorded,
               CASE WHEN v.created IS NULL THEN NULL
                    ELSE GREATEST(v.created, COALESCE((
                        SELECT floor(EXTRACT(EPOCH FROM upper(p)))::BIGINT
                          FROM unnest(v.recorded + COALESCE((
                                   SELECT range_agg(tstzrange(g.gap_from, g.gap_to))
                                     FROM device_em.em_device_gap g
                                    WHERE g.device = v.device
                                      AND g.channel = v.channel
                                      AND g.gap_to > to_timestamp(v.created)
                               ), '{}'::tstzmultirange)) AS p
                         WHERE p @> to_timestamp(v.created)
                   ), v.created))
               END AS created
          FROM cov v
    ),
    dirty AS (
        INSERT INTO device_em.rollup_dirty
            (bucket, device, tag, domain, phase, channel, ready_at)
        SELECT k.bucket, k.device, k.tag, k.domain, k.phase, k.channel,
               CASE
                   WHEN k.bucket + INTERVAL '15 min' <= to_timestamp(m.created)
                       THEN now()
                   WHEN k.bucket + INTERVAL '15 min' > now()
                       THEN k.bucket + INTERVAL '15 min'
                            + make_interval(secs => p_close_grace_ms / 1000.0)
                   ELSE now() + make_interval(secs => p_late_debounce_ms / 1000.0)
               END
          FROM (
              SELECT DISTINCT
                     time_bucket(INTERVAL '15 min', i.ts) AS bucket,
                     i.device, i.tag, i.domain, i.phase, i.channel
                FROM ins i
          ) k
          JOIN mark m
            ON m.device = k.device
           AND m.channel = k.channel
         ORDER BY 1, 2, 3, 4, 5, 6
        ON CONFLICT (bucket, device, tag, domain, phase, channel)
            DO UPDATE SET last_dirty = now(),
                          ready_at = LEAST(device_em.rollup_dirty.ready_at,
                                           EXCLUDED.ready_at)
            -- A due or earlier key changes nothing; a held key is released.
            WHERE device_em.rollup_dirty.blocked_at IS NOT NULL
               OR device_em.rollup_dirty.ready_at > EXCLUDED.ready_at
        RETURNING 1
    ),
    published AS (
        SELECT m.device, m.channel, m.old_created, m.created,
               CASE WHEN f.floor = '-infinity'::TIMESTAMPTZ THEN m.recorded
                    ELSE m.recorded - tstzmultirange(tstzrange(NULL, f.floor))
               END AS recorded
          FROM mark m
         CROSS JOIN LATERAL (
             SELECT device_em.fn_em_coverage_floor(m.created, v_horizon) AS floor
         ) f
    ),
    upd AS (
        UPDATE device_em.sync s
           SET recorded = p.recorded,
               created = p.created
          FROM published p
         WHERE s.device = p.device
           AND s.channel = p.channel
           AND (s.recorded IS DISTINCT FROM p.recorded
                OR s.created IS DISTINCT FROM p.created)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM ins),
           (SELECT array_agg(m.created ORDER BY m.device, m.channel) FROM mark m)
      INTO v_count, v_new_created
      FROM (SELECT count(*) FROM dirty) ensure_dirty_exec
     CROSS JOIN (SELECT count(*) FROM upd) ensure_upd_exec;

    -- S6: only blocks whose end the watermark crossed in this call, found by
    -- key (rollup_dirty_key); S3 already made this call's own keys due. A
    -- key missed here (held by another transaction) closes on its timer.
    UPDATE device_em.rollup_dirty d
       SET ready_at = now()
     WHERE d.id IN (
         SELECT k.id
           FROM unnest(v_dev, v_ch, v_created, v_new_created)
                AS c(device, channel, old_created, created)
          CROSS JOIN LATERAL generate_series(
              time_bucket(INTERVAL '15 min', to_timestamp(c.old_created)),
              to_timestamp(c.created) - INTERVAL '15 min',
              INTERVAL '15 min'
          ) AS b(bucket)
          CROSS JOIN LATERAL (
              SELECT r.id
                FROM device_em.rollup_dirty r
               WHERE r.bucket = b.bucket
                 AND r.device = c.device
                 AND r.channel = c.channel
                 AND r.blocked_at IS NULL
                 AND r.ready_at > now()
                 FOR UPDATE SKIP LOCKED
          ) k
          WHERE c.created > c.old_created
     );
    RETURN v_count;
END;
$$;

-- Per channel: the bookmark and the first stored record after it, so a pull
-- asks only for the hole between them. Read from coverage once it is built.
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
           CASE WHEN s.recorded IS NOT NULL THEN (
               SELECT EXTRACT(EPOCH FROM min(lower(p)))::BIGINT
                 FROM unnest(s.recorded) AS p
                WHERE lower(p) > to_timestamp(s.created)
                  AND lower(p) < to_timestamp(s.created) + INTERVAL '1 day'
           ) ELSE (
               SELECT EXTRACT(EPOCH FROM min(st.ts))::BIGINT
                 FROM device_em.stats st
                WHERE st.device = s.device
                  AND st.channel = s.channel
                  AND st.tag = 'total_act_energy'
                  AND st.source = 'em_sync'
                  AND st.ts > to_timestamp(s.created)
                  AND st.ts < to_timestamp(s.created) + INTERVAL '1 day'
           ) END
      FROM device_em.sync s
     WHERE s.device = ANY(p_devices)
       AND s.channel IS NOT NULL
       AND s.created IS NOT NULL
     ORDER BY s.device, s.channel;
$$;

-- 20175 on coverage: a filled range is resolved, a partly filled one is
-- replaced by what is still missing.
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
        v_left := v_whole - device_em.fn_em_channel_coverage(
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

-- 20175 on coverage: scans [scanned_to, horizon) for ranges with neither a
-- record nor a device gap; the horizon is the earlier of p_until and the end
-- of the last stored record.
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
    v_from     TIMESTAMP WITH TIME ZONE;
    v_start    TIMESTAMP WITH TIME ZONE;
    v_last     TIMESTAMP WITH TIME ZONE;
    v_horizon  TIMESTAMP WITH TIME ZONE;
    v_recorded tstzmultirange;
    v_created  BIGINT;
BEGIN
    SELECT s.scanned_to INTO v_from
      FROM device_em.em_completeness_state s
     WHERE s.device = p_device AND s.channel = p_channel
       FOR UPDATE;
    v_start := COALESCE(v_from, p_until - p_max_span);
    SELECT s.recorded, s.created INTO v_recorded, v_created
      FROM device_em.sync s
     WHERE s.device = p_device AND s.channel = p_channel;
    IF v_recorded IS NOT NULL
       AND v_start >= device_em.fn_em_coverage_floor(
               v_created, device_em.fn_stats_retention_horizon()) THEN
        SELECT max(upper(p)) INTO v_last
          FROM unnest(v_recorded) AS p
         WHERE upper(p) > v_start
           AND lower(p) < p_until;
    ELSE
        SELECT max(st.ts + make_interval(secs => st.sample_period)) INTO v_last
          FROM device_em.stats st
         WHERE st.device = p_device
           AND st.channel = p_channel
           AND st.tag = 'total_act_energy'
           AND st.source = 'em_sync'
           AND st.sample_period IS NOT NULL
           AND st.ts >= v_start
           AND st.ts < p_until;
    END IF;
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
               - device_em.fn_em_channel_coverage(
                     p_device, p_channel, v_from, v_horizon)
           ) AS piece
    ON CONFLICT DO NOTHING;
    UPDATE device_em.em_completeness_state
       SET scanned_to = v_horizon
     WHERE device = p_device AND channel = p_channel;
END;
$$;

-- The earliest still-missing part of the stored open ranges below each
-- channel's complete-up-to, cut at the retention horizon. Current coverage
-- and device gaps are subtracted, so a hole filled since the last scan is not
-- pulled again.
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
    SELECT s.device, s.channel, h.hole_from, h.hole_to
      FROM device_em.sync s
     CROSS JOIN LATERAL (
         SELECT EXTRACT(EPOCH FROM lower(p))::BIGINT AS hole_from,
                EXTRACT(EPOCH FROM upper(p))::BIGINT AS hole_to
           FROM device_em.em_incomplete_range r
          CROSS JOIN LATERAL (
              SELECT GREATEST(
                         r.range_from,
                         COALESCE(device_em.fn_stats_retention_horizon(), '-infinity')
                     ) AS cut_from
          ) c
          CROSS JOIN LATERAL unnest(
              tstzmultirange(tstzrange(c.cut_from, r.range_to))
              - device_em.fn_em_channel_coverage(
                    r.device, r.channel, c.cut_from, r.range_to)
          ) AS p
          WHERE r.device = s.device
            AND r.channel = s.channel
            AND r.kind = 'missing_records'
            AND r.resolved_at IS NULL
            AND r.range_to <= to_timestamp(s.created)
            AND r.range_to > COALESCE(device_em.fn_stats_retention_horizon(), '-infinity')
          ORDER BY r.range_from, lower(p)
          LIMIT 1
     ) h
     WHERE s.device = ANY(p_devices)
       AND s.channel IS NOT NULL
       AND s.created IS NOT NULL
     ORDER BY s.device, s.channel;
$$;

-- Channels the check walks: every channel with a seeded bookmark.
CREATE OR REPLACE FUNCTION device_em.fn_em_completeness_channels()
RETURNS TABLE (device INT, channel INT)
LANGUAGE sql
STABLE
AS $$
    SELECT s.device, s.channel
      FROM device_em.sync s
     WHERE s.channel IS NOT NULL
       AND s.created IS NOT NULL
     ORDER BY s.device, s.channel;
$$;

-- 20022 without rows that hold coverage but no seeded bookmark yet.
CREATE OR REPLACE FUNCTION device_em.fn_last_sync_batch(
    p_devices INT[]
)
    RETURNS TABLE (device INT, channel INT, created BIGINT)
AS
$$
    SELECT s.device, s.channel, MAX(s.created) AS created
      FROM device_em.sync AS s
     WHERE s.device = ANY(p_devices)
       AND s.created IS NOT NULL
     GROUP BY s.device, s.channel;
$$
LANGUAGE sql STABLE;

-- 20181 v4, kept for rollback, plus: it clears the coverage of every channel
-- it writes, so v5 rebuilds that coverage from stats after a roll forward.
CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch_v4(
    p_device           INT[],
    p_tag              VARCHAR(30)[],
    p_domain           VARCHAR(16)[],
    p_phase            VARCHAR(1)[],
    p_channel          SMALLINT[],
    p_ts               BIGINT[],
    p_val              REAL[],
    p_source           VARCHAR(16),
    p_sync_device      INT[],
    p_sync_created     BIGINT[],
    p_sync_channel     INT[],
    p_period           INT[],
    p_gap_device       INT[],
    p_gap_channel      INT[],
    p_gap_from         BIGINT[],
    p_gap_to           BIGINT[],
    p_close_grace_ms   INT,
    p_late_debounce_ms INT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count   BIGINT;
    v_key     RECORD;
    v_horizon TIMESTAMPTZ := device_em.fn_stats_retention_horizon();
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
    IF p_close_grace_ms IS NULL OR p_close_grace_ms < 0
       OR p_late_debounce_ms IS NULL OR p_late_debounce_ms < 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EM_ROLLUP_TIMING_INVALID';
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
        AND NOT (
            to_timestamp(u._ts) < v_horizon
            AND EXISTS (
                SELECT 1
                  FROM device_em.sync b
                 WHERE b.device = u.device
                   AND b.channel IS NOT DISTINCT FROM u.channel::INT
                   AND b.created > u._ts
            )
        )
        ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts, u.val, u.period
        RETURNING device, tag, domain, phase, channel, ts
    ),
    dirty AS (
        INSERT INTO device_em.rollup_dirty
            (bucket, device, tag, domain, phase, channel, ready_at)
        SELECT k.bucket, k.device, k.tag, k.domain, k.phase, k.channel,
               CASE
                   WHEN k.bucket + INTERVAL '15 min' > now()
                       THEN k.bucket + INTERVAL '15 min'
                            + make_interval(secs => p_close_grace_ms / 1000.0)
                   ELSE now() + make_interval(secs => p_late_debounce_ms / 1000.0)
               END
        FROM (
            SELECT DISTINCT
                   time_bucket(INTERVAL '15 min', i.ts) AS bucket,
                   i.device, i.tag, i.domain, i.phase, i.channel
            FROM ins i
        ) k
        ORDER BY 1, 2, 3, 4, 5, 6
        ON CONFLICT (bucket, device, tag, domain, phase, channel)
            DO UPDATE SET last_dirty = now(),
                          ready_at = LEAST(device_em.rollup_dirty.ready_at,
                                           EXCLUDED.ready_at)
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
        PERFORM device_em.fn_em_rollup_fire_complete(
            v_key.device,
            v_key.channel,
            device_em.fn_em_sync_advance(v_key.device, v_key.channel)
        );
    END LOOP;
    -- v4 stores rows without recording them; v5 rebuilds what it bypassed.
    UPDATE device_em.sync s
       SET recorded = NULL
      FROM (
          SELECT DISTINCT u.device, u.channel::INT AS channel
            FROM unnest(p_device, p_channel) AS u(device, channel)
      ) k
     WHERE s.device = k.device
       AND s.channel = k.channel
       AND s.recorded IS NOT NULL;
    RETURN v_count;
END;
$$;
--------------DOWN
SET search_path TO device_em, public;

-- 20181 v4 as shipped.
CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch_v4(
    p_device           INT[],
    p_tag              VARCHAR(30)[],
    p_domain           VARCHAR(16)[],
    p_phase            VARCHAR(1)[],
    p_channel          SMALLINT[],
    p_ts               BIGINT[],
    p_val              REAL[],
    p_source           VARCHAR(16),
    p_sync_device      INT[],
    p_sync_created     BIGINT[],
    p_sync_channel     INT[],
    p_period           INT[],
    p_gap_device       INT[],
    p_gap_channel      INT[],
    p_gap_from         BIGINT[],
    p_gap_to           BIGINT[],
    p_close_grace_ms   INT,
    p_late_debounce_ms INT
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count   BIGINT;
    v_key     RECORD;
    v_horizon TIMESTAMPTZ := device_em.fn_stats_retention_horizon();
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
    IF p_close_grace_ms IS NULL OR p_close_grace_ms < 0
       OR p_late_debounce_ms IS NULL OR p_late_debounce_ms < 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EM_ROLLUP_TIMING_INVALID';
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
        AND NOT (
            to_timestamp(u._ts) < v_horizon
            AND EXISTS (
                SELECT 1
                  FROM device_em.sync b
                 WHERE b.device = u.device
                   AND b.channel IS NOT DISTINCT FROM u.channel::INT
                   AND b.created > u._ts
            )
        )
        ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts, u.val, u.period
        RETURNING device, tag, domain, phase, channel, ts
    ),
    dirty AS (
        INSERT INTO device_em.rollup_dirty
            (bucket, device, tag, domain, phase, channel, ready_at)
        SELECT k.bucket, k.device, k.tag, k.domain, k.phase, k.channel,
               CASE
                   WHEN k.bucket + INTERVAL '15 min' > now()
                       THEN k.bucket + INTERVAL '15 min'
                            + make_interval(secs => p_close_grace_ms / 1000.0)
                   ELSE now() + make_interval(secs => p_late_debounce_ms / 1000.0)
               END
        FROM (
            SELECT DISTINCT
                   time_bucket(INTERVAL '15 min', i.ts) AS bucket,
                   i.device, i.tag, i.domain, i.phase, i.channel
            FROM ins i
        ) k
        ORDER BY 1, 2, 3, 4, 5, 6
        ON CONFLICT (bucket, device, tag, domain, phase, channel)
            DO UPDATE SET last_dirty = now(),
                          ready_at = LEAST(device_em.rollup_dirty.ready_at,
                                           EXCLUDED.ready_at)
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
        PERFORM device_em.fn_em_rollup_fire_complete(
            v_key.device,
            v_key.channel,
            device_em.fn_em_sync_advance(v_key.device, v_key.channel)
        );
    END LOOP;
    RETURN v_count;
END;
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

-- 20175, cut at the retention horizon: gap fill asks only for minutes raw
-- retention still holds.
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
           EXTRACT(EPOCH FROM GREATEST(
               r.range_from,
               COALESCE(device_em.fn_stats_retention_horizon(), '-infinity')
           ))::BIGINT,
           EXTRACT(EPOCH FROM r.range_to)::BIGINT
      FROM device_em.em_incomplete_range r
      JOIN device_em.sync s
        ON s.device = r.device
       AND s.channel = r.channel
     WHERE r.device = ANY(p_devices)
       AND r.kind = 'missing_records'
       AND r.resolved_at IS NULL
       AND r.range_to <= to_timestamp(s.created)
       AND r.range_to > COALESCE(device_em.fn_stats_retention_horizon(), '-infinity')
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

CREATE OR REPLACE FUNCTION device_em.fn_last_sync_batch(
    p_devices INT[]
)
    RETURNS TABLE (device INT, channel INT, created BIGINT)
AS
$$
    SELECT s.device, s.channel, MAX(s.created) AS created
      FROM device_em.sync AS s
     WHERE s.device = ANY(p_devices)
     GROUP BY s.device, s.channel;
$$
LANGUAGE sql STABLE;

DROP FUNCTION IF EXISTS device_em.fn_append_stats_synced_batch_v5(
    INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[],
    REAL[], VARCHAR(16), INT[], BIGINT[], INT[], INT[], INT[], INT[],
    BIGINT[], BIGINT[], INT, INT);
DROP FUNCTION IF EXISTS device_em.fn_em_channel_coverage(
    INT, INT, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS device_em.fn_em_coverage_bootstrap(INT);
DROP FUNCTION IF EXISTS device_em.fn_em_stats_coverage(INT, INT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS device_em.fn_em_coverage_floor(BIGINT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS device_em.fn_em_record_span(TIMESTAMPTZ, INT);
DELETE FROM device_em.sync WHERE created IS NULL;
ALTER TABLE device_em.sync ALTER COLUMN created SET NOT NULL;
ALTER TABLE device_em.sync RESET (fillfactor);
ALTER TABLE device_em.sync DROP COLUMN IF EXISTS recorded;
