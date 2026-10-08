-- An EM meter's 15-minute bucket is recomputed once, when it closes, instead
-- of on every minute record. rollup_dirty.ready_at says when a key may be
-- claimed. Live writers (PM, BLU, every non-record source) keep it due at
-- once, so they behave as before. A record write schedules its open bucket for
-- bucket end plus a close grace; the bucket becomes due as soon as the
-- channel's complete-up-to bookmark passes its end. A late record makes its
-- key due after a short debounce and never postpones a key that is due.
-- Readers add the records of buckets not yet rolled, and status reports
-- scheduled work apart from due work. Gap fill and late correction stop at
-- the raw retention horizon; older missing minutes stay incomplete.
-- Design: report/local-ci/architecture-review-2026-10-07/em-rollup-close-once-research.md.
--------------UP
SET search_path TO device_em, public;

ALTER TABLE device_em.rollup_dirty
    ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS rollup_dirty_due
    ON device_em.rollup_dirty (ready_at, id)
    WHERE blocked_at IS NULL;

-- Why a stored range is incomplete when it can no longer be filled.
ALTER TABLE device_em.em_incomplete_range
    ADD COLUMN IF NOT EXISTS reason VARCHAR(32);

-- W1: a live write keeps its key due; a scheduled key it touches becomes due.
CREATE OR REPLACE FUNCTION device_em.fn_append_stats_dirty(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_domain  VARCHAR(16)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[],
    p_source  VARCHAR(16)
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
AS $$
    WITH ins AS MATERIALIZED (
        INSERT INTO device_em.stats
            (device, tag, domain, phase, channel, ts, val, source)
        SELECT DISTINCT ON
               (u.device, u.tag, u.domain, u.phase, u.channel, u._ts)
               u.device, u.tag, u.domain, u.phase, u.channel,
               to_timestamp(u._ts), u.val, p_source
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val)
             AS u(device, tag, domain, phase, channel, _ts, val)
        ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts
        RETURNING device, tag, domain, phase, channel, ts, val
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
            DO UPDATE SET last_dirty = now(),
                          ready_at = LEAST(device_em.rollup_dirty.ready_at, now())
        RETURNING 1
    )
    SELECT i.device, i.tag, i.domain, i.phase, i.channel,
           EXTRACT(EPOCH FROM i.ts)::BIGINT, i.val
    FROM ins i
    CROSS JOIN (SELECT count(*) FROM dirty) ensure_dirty_exec;
$$;

-- First whole minute of raw history Fleet still keeps; NULL when retention
-- is unset. Minute records are kept or given up whole.
CREATE OR REPLACE FUNCTION device_em.fn_stats_retention_horizon()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
    SELECT CASE WHEN date_trunc('minute', k.kept_from) = k.kept_from
                THEN k.kept_from
                ELSE date_trunc('minute', k.kept_from) + INTERVAL '1 minute'
           END
      FROM (SELECT now() - device_em.fn_stats_retention_interval() AS kept_from) k;
$$;

-- W3: every scheduled bucket of the channel that ends at or before the
-- bookmark is complete, so it is due now. A row another transaction holds is
-- skipped: the worker is computing it, or that writer fires it itself.
CREATE OR REPLACE FUNCTION device_em.fn_em_rollup_fire_complete(
    p_device   INT,
    p_channel  INT,
    p_bookmark BIGINT
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE device_em.rollup_dirty d
       SET ready_at = now()
     WHERE d.id IN (
         SELECT s.id
           FROM device_em.rollup_dirty s
          WHERE s.device = p_device
            AND s.channel = p_channel
            AND s.blocked_at IS NULL
            AND s.ready_at > now()
            AND s.bucket + INTERVAL '15 min' <= to_timestamp(p_bookmark)
          ORDER BY s.id
            FOR UPDATE SKIP LOCKED
     );
$$;

-- v3 plus close-once timing (W2, W3) and the retention horizon: a record
-- older than the horizon and below its channel's bookmark is a late
-- correction raw retention can no longer hold, so it is not stored; the
-- completeness check keeps that range incomplete.
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

-- C1: the earliest due row picks the bucket; up to p_limit due rows of that
-- bucket are projected. Completed keys are counted by the source the
-- projection saved, so recomputes per bucket are visible per source.
CREATE OR REPLACE FUNCTION device_em.fn_rollup_due_batch(p_limit INT DEFAULT 500)
RETURNS TABLE (
    completed         INT,
    blocked           INT,
    completed_em_sync INT,
    completed_live    INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_bucket    TIMESTAMPTZ;
    v_ids       BIGINT[];
    v_keys      device_em.rollup_dirty[];
    v_completed INT;
    v_blocked   INT;
BEGIN
    LOCK TABLE ONLY device_em.stats IN ROW EXCLUSIVE MODE;
    SELECT d.bucket INTO v_bucket FROM device_em.rollup_dirty d
     WHERE d.blocked_at IS NULL AND d.ready_at <= now()
     ORDER BY d.ready_at, d.id
       FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN QUERY SELECT 0, 0, 0, 0; RETURN; END IF;
    SELECT array_agg(c.id ORDER BY c.id), array_agg(c.d ORDER BY c.id)
      INTO v_ids, v_keys
      FROM (
          SELECT d.id, d FROM device_em.rollup_dirty d
           WHERE d.bucket = v_bucket AND d.blocked_at IS NULL
             AND d.ready_at <= now()
           ORDER BY d.id
             FOR UPDATE SKIP LOCKED LIMIT GREATEST(1, p_limit)
      ) c;
    SELECT p.completed, p.blocked INTO v_completed, v_blocked
      FROM device_em.fn_project_rollup_keys(v_ids) p;
    RETURN QUERY
    SELECT v_completed, v_blocked,
           (count(*) FILTER (WHERE e.source_kind = 'em_sync'))::INT,
           (count(*) FILTER (WHERE e.source_kind = 'live'))::INT
      FROM unnest(v_keys) k
      JOIN device_em.energy_15min e
        ON e.bucket = k.bucket AND e.device = k.device AND e.tag = k.tag
       AND e.domain = k.domain AND e.phase IS NOT DISTINCT FROM k.phase
       AND e.channel IS NOT DISTINCT FROM k.channel
     WHERE NOT EXISTS (
         SELECT 1 FROM device_em.rollup_dirty d WHERE d.id = k.id
     );
END;
$$;

-- The same claim for callers that read only the totals.
CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty_batch(p_limit INT DEFAULT 500)
RETURNS TABLE (completed INT, blocked INT)
LANGUAGE sql
AS $$
    SELECT b.completed, b.blocked FROM device_em.fn_rollup_due_batch(p_limit) b;
$$;

-- Report scope: due work is 'ready'; work waiting for its bucket to close or
-- its debounce is 'scheduled'; blocked work is held or abandoned.
CREATE OR REPLACE FUNCTION device_em.fn_rollup_backlog_in_scope(
    p_devices INT[],
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS TABLE (state TEXT, reason TEXT, buckets BIGINT)
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
               WHEN d.blocked_at IS NULL AND d.ready_at > now() THEN 'scheduled'
               WHEN d.blocked_at IS NULL THEN 'ready'
               WHEN d.abandoned_at IS NULL THEN 'held'
               ELSE 'abandoned'
           END,
           d.blocked_reason,
           count(*)::BIGINT
    FROM device_em.rollup_dirty d
    WHERE d.device = ANY(p_devices)
      AND d.bucket >= time_bucket(INTERVAL '15 min', p_from)
      AND d.bucket < p_to
    GROUP BY 1, 2;
$$;

-- Ready (due) age is the time the oldest due key has waited since it became
-- due; for live keys that is since first dirty, as before.
CREATE OR REPLACE FUNCTION device_em.fn_rollup_backlog_stats()
RETURNS TABLE (
    state TEXT,
    reason TEXT,
    buckets BIGINT,
    oldest_age_seconds DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    WITH blocked AS MATERIALIZED (
        SELECT CASE WHEN d.abandoned_at IS NULL THEN 'held' ELSE 'abandoned' END AS state,
               d.blocked_reason AS reason,
               count(*)::BIGINT AS buckets,
               EXTRACT(EPOCH FROM now() - min(d.bucket))::DOUBLE PRECISION AS oldest_age_seconds
        FROM device_em.rollup_dirty d
        WHERE d.blocked_at IS NOT NULL
        GROUP BY 1, 2
    ),
    scheduled AS MATERIALIZED (
        SELECT count(*)::BIGINT AS buckets,
               COALESCE(EXTRACT(EPOCH FROM now() - min(d.first_dirty)), 0)::DOUBLE PRECISION
                   AS oldest_age_seconds
        FROM device_em.rollup_dirty d
        WHERE d.blocked_at IS NULL AND d.ready_at > now()
    )
    -- Ready count is the table estimate less the exact blocked and scheduled
    -- counts, so the read stays cheap however large a catch-up backlog grows.
    SELECT 'ready', NULL::TEXT,
           GREATEST(
               pg_stat_get_live_tuples('device_em.rollup_dirty'::regclass)
                   - (SELECT COALESCE(sum(b.buckets), 0) FROM blocked b)
                   - (SELECT s.buckets FROM scheduled s),
               0
           )::BIGINT,
           COALESCE(
               EXTRACT(EPOCH FROM now() - (
                   SELECT d.ready_at FROM device_em.rollup_dirty d
                   WHERE d.blocked_at IS NULL AND d.ready_at <= now()
                   ORDER BY d.ready_at LIMIT 1
               )),
               0
           )::DOUBLE PRECISION
    UNION ALL
    SELECT 'scheduled', NULL::TEXT, s.buckets, s.oldest_age_seconds FROM scheduled s
    UNION ALL
    SELECT b.state, b.reason, b.buckets, b.oldest_age_seconds FROM blocked b;
$$;

-- Per channel: pending is due and blocked work; scheduled is work waiting for
-- its bucket to close, which no reader needs to wait for.
CREATE OR REPLACE FUNCTION device_em.fn_sync_status_v2(
    p_devices INT[],
    p_channels INT[]
)
RETURNS TABLE (
    device INT,
    channel INT,
    sync_created BIGINT,
    rollup_pending BIGINT,
    oldest_rollup_dirty TIMESTAMPTZ,
    rollup_scheduled BIGINT
)
LANGUAGE sql
STABLE
AS $$
    WITH requested AS (
        SELECT DISTINCT u.device, u.channel
        FROM unnest(p_devices, p_channels) AS u(device, channel)
    ),
    sync_latest AS (
        SELECT s.device, s.channel, max(s.created) AS sync_created
        FROM device_em.sync s
        WHERE s.device = ANY(p_devices)
        GROUP BY s.device, s.channel
    ),
    dirty AS (
        SELECT d.device, d.channel,
               count(*) FILTER (WHERE NOT (d.blocked_at IS NULL AND d.ready_at > now()))::BIGINT
                   AS rollup_pending,
               min(d.first_dirty) FILTER (WHERE NOT (d.blocked_at IS NULL AND d.ready_at > now()))
                   AS oldest_rollup_dirty,
               count(*) FILTER (WHERE d.blocked_at IS NULL AND d.ready_at > now())::BIGINT
                   AS rollup_scheduled
        FROM device_em.rollup_dirty d
        WHERE d.device = ANY(p_devices)
        GROUP BY d.device, d.channel
    )
    SELECT
        r.device,
        r.channel,
        s.sync_created,
        COALESCE(d.rollup_pending, 0),
        d.oldest_rollup_dirty,
        COALESCE(d.rollup_scheduled, 0)
    FROM requested r
    LEFT JOIN sync_latest s
      ON s.device = r.device
     AND s.channel = r.channel
    LEFT JOIN dirty d
      ON d.device = r.device
     AND d.channel IS NOT DISTINCT FROM r.channel
    ORDER BY r.device, r.channel;
$$;

-- v2 without the scheduled count, for existing callers.
CREATE OR REPLACE FUNCTION device_em.fn_sync_status(
    p_devices INT[],
    p_channels INT[]
)
RETURNS TABLE (
    device INT,
    channel INT,
    sync_created BIGINT,
    rollup_pending BIGINT,
    oldest_rollup_dirty TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT s.device, s.channel, s.sync_created, s.rollup_pending, s.oldest_rollup_dirty
      FROM device_em.fn_sync_status_v2(p_devices, p_channels) s;
$$;

-- 15-minute rows for a scope: the rollup, except where a meter's records are
-- not rolled yet (queued and not blocked): there the meter's own minute
-- records under the shared raw rule, never live rows. Only buckets inside raw
-- retention, so a partly expired bucket keeps its saved total. A custom device
-- in the scope owns the source channels it represents (20163).
CREATE OR REPLACE FUNCTION device_em.fn_energy_15min_rows(
    p_devices INT[],
    p_from    TIMESTAMPTZ,
    p_to      TIMESTAMPTZ,
    p_tags    VARCHAR(30)[]
)
RETURNS TABLE (
    bucket            TIMESTAMPTZ,
    device            INT,
    tag               VARCHAR(30),
    domain            VARCHAR(16),
    phase             VARCHAR(1),
    channel           SMALLINT,
    sum_val           DOUBLE PRECISION,
    sample_count      BIGINT,
    min_val           DOUBLE PRECISION,
    max_val           DOUBLE PRECISION,
    commodity         VARCHAR(12),
    electrical_source VARCHAR(16)
)
LANGUAGE sql
STABLE
AS $$
    WITH unrolled AS MATERIALIZED (
        SELECT d.bucket, d.device, d.tag, d.domain, d.phase, d.channel
          FROM device_em.rollup_dirty d
         WHERE d.device = ANY(p_devices)
           AND d.tag = ANY(p_tags)
           AND d.bucket >= p_from
           AND d.bucket < p_to
           AND d.blocked_at IS NULL
           AND d.bucket >= COALESCE(device_em.fn_stats_retention_horizon(), '-infinity')
    ),
    records AS MATERIALIZED (
        SELECT time_bucket(INTERVAL '15 min', r.ts) AS bucket,
               r.device, r.tag, r.domain, r.phase, r.channel,
               sum(r.val) AS sum_val, count(*)::BIGINT AS sample_count,
               min(r.val) AS min_val, max(r.val) AS max_val,
               r.commodity, r.electrical_source
          FROM (SELECT DISTINCT u.bucket FROM unrolled u) b
          CROSS JOIN LATERAL device_em.fn_stats_readings(
              p_devices, b.bucket, b.bucket + INTERVAL '15 min', p_tags, FALSE) r
         WHERE r.source = 'em_sync'
           AND EXISTS (
               SELECT 1 FROM unrolled u
                WHERE u.bucket = b.bucket AND u.device = r.device AND u.tag = r.tag
                  AND u.domain = r.domain AND u.phase IS NOT DISTINCT FROM r.phase
                  AND u.channel IS NOT DISTINCT FROM r.channel
           )
         GROUP BY 1, r.device, r.tag, r.domain, r.phase, r.channel,
                  r.commodity, r.electrical_source
    )
    SELECT e.bucket, e.device, e.tag, e.domain, e.phase, e.channel,
           e.sum_val, e.sample_count, e.min_val, e.max_val,
           e.commodity, e.electrical_source
      FROM device_em.energy_15min e
     WHERE e.device = ANY(p_devices) AND e.bucket >= p_from AND e.bucket < p_to
       AND e.tag = ANY(p_tags)
       AND NOT EXISTS (
           SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
            WHERE r.source_device = e.device AND r.source_channel = COALESCE(e.channel, 0)
              AND e.bucket >= r.effective_from AND e.bucket < r.effective_until
              AND device_em.fn_projection_field_covers(r.projection_field, e.tag))
       AND NOT EXISTS (
           SELECT 1 FROM records x
            WHERE x.bucket = e.bucket AND x.device = e.device AND x.tag = e.tag
              AND x.domain = e.domain AND x.phase IS NOT DISTINCT FROM e.phase
              AND x.channel IS NOT DISTINCT FROM e.channel)
    UNION ALL
    SELECT x.bucket, x.device, x.tag, x.domain, x.phase, x.channel,
           x.sum_val, x.sample_count, x.min_val, x.max_val,
           x.commodity, x.electrical_source
      FROM records x;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.fn_energy_15min_rows(p_devices, p_from, p_to, p_tags) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.fn_energy_15min_rows(p_devices, p_from, p_to, p_tags) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_paged(
    p_devices integer[],
    p_from timestamp with time zone,
    p_to timestamp with time zone,
    p_tags character varying[],
    p_bucket text,
    p_per_device boolean DEFAULT true,
    p_limit integer DEFAULT NULL::integer,
    p_offset integer DEFAULT 0,
    p_commodity text DEFAULT NULL::text,
    p_electrical_source text DEFAULT NULL::text
)
RETURNS TABLE (
    bucket timestamp with time zone,
    device integer,
    tag character varying,
    agg_value double precision,
    domain character varying
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.fn_energy_15min_rows(p_devices, p_from, p_to, p_tags) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain
    ORDER BY 1, 2, 3, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
    p_devices integer[],
    p_from timestamp with time zone,
    p_to timestamp with time zone,
    p_tags character varying[],
    p_bucket text,
    p_per_device boolean DEFAULT true,
    p_limit integer DEFAULT NULL::integer,
    p_offset integer DEFAULT 0,
    p_commodity text DEFAULT NULL::text,
    p_electrical_source text DEFAULT NULL::text
)
RETURNS TABLE (
    bucket timestamp with time zone,
    device integer,
    phase character varying,
    tag character varying,
    agg_value double precision,
    domain character varying
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.fn_energy_15min_rows(p_devices, p_from, p_to, p_tags) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;


-- Allowed lateness ends at the raw retention horizon. An open missing range
-- older than it can no longer be filled and stored as raw: it is cut at the
-- horizon and its older part keeps reason 'beyond_retention', so reports go on
-- showing it as incomplete, never as zero.
CREATE OR REPLACE FUNCTION device_em.fn_em_mark_beyond_retention(
    p_device  INT,
    p_channel INT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_horizon TIMESTAMPTZ := device_em.fn_stats_retention_horizon();
    v_open    RECORD;
BEGIN
    IF v_horizon IS NULL THEN
        RETURN;
    END IF;
    FOR v_open IN
        SELECT r.id, r.range_to
          FROM device_em.em_incomplete_range r
         WHERE r.device = p_device
           AND r.channel = p_channel
           AND r.kind = 'missing_records'
           AND r.resolved_at IS NULL
           AND r.reason IS NULL
           AND r.range_from < v_horizon
         ORDER BY r.range_from
    LOOP
        UPDATE device_em.em_incomplete_range
           SET range_to = LEAST(range_to, v_horizon),
               reason = 'beyond_retention'
         WHERE id = v_open.id;
        IF v_open.range_to > v_horizon THEN
            INSERT INTO device_em.em_incomplete_range
                (device, channel, kind, tag, range_from, range_to)
            VALUES (p_device, p_channel, 'missing_records', 'total_act_energy',
                    v_horizon, v_open.range_to)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END;
$$;

-- 20175 plus the retention cut after the scan.
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
    PERFORM device_em.fn_em_mark_beyond_retention(p_device, p_channel);
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
--------------DOWN
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
      -- A custom device in the scope owns the source channels it represents (20163).
      AND NOT EXISTS (
          SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
           WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0)
             AND s.bucket >= r.effective_from AND s.bucket < r.effective_until
             AND device_em.fn_projection_field_covers(r.projection_field, s.tag))
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
      -- A custom device in the scope owns the source channels it represents (20163).
      AND NOT EXISTS (
          SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
           WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0)
             AND s.bucket >= r.effective_from AND s.bucket < r.effective_until
             AND device_em.fn_projection_field_covers(r.projection_field, s.tag))
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_paged(
    p_devices integer[],
    p_from timestamp with time zone,
    p_to timestamp with time zone,
    p_tags character varying[],
    p_bucket text,
    p_per_device boolean DEFAULT true,
    p_limit integer DEFAULT NULL::integer,
    p_offset integer DEFAULT 0,
    p_commodity text DEFAULT NULL::text,
    p_electrical_source text DEFAULT NULL::text
)
RETURNS TABLE (
    bucket timestamp with time zone,
    device integer,
    tag character varying,
    agg_value double precision,
    domain character varying
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
        AND (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
      -- A custom device in the scope owns the source channels it represents (20163).
      AND NOT EXISTS (
          SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
           WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0)
             AND s.bucket >= r.effective_from AND s.bucket < r.effective_until
             AND device_em.fn_projection_field_covers(r.projection_field, s.tag))
    GROUP BY 1, 2, 3, s.domain
    ORDER BY 1, 2, 3, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
    p_devices integer[],
    p_from timestamp with time zone,
    p_to timestamp with time zone,
    p_tags character varying[],
    p_bucket text,
    p_per_device boolean DEFAULT true,
    p_limit integer DEFAULT NULL::integer,
    p_offset integer DEFAULT 0,
    p_commodity text DEFAULT NULL::text,
    p_electrical_source text DEFAULT NULL::text
)
RETURNS TABLE (
    bucket timestamp with time zone,
    device integer,
    phase character varying,
    tag character varying,
    agg_value double precision,
    domain character varying
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
        AND (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
      -- A custom device in the scope owns the source channels it represents (20163).
      AND NOT EXISTS (
          SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
           WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0)
             AND s.bucket >= r.effective_from AND s.bucket < r.effective_until
             AND device_em.fn_projection_field_covers(r.projection_field, s.tag))
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;


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

DROP FUNCTION IF EXISTS device_em.fn_em_mark_beyond_retention(INT, INT);
DROP FUNCTION IF EXISTS device_em.fn_energy_15min_rows(INT[], TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR(30)[]);

CREATE OR REPLACE FUNCTION device_em.fn_sync_status(p_devices integer[], p_channels integer[])
 RETURNS TABLE(device integer, channel integer, sync_created bigint, rollup_pending bigint, oldest_rollup_dirty timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
WITH requested AS (
SELECT DISTINCT u.device, u.channel
FROM unnest(p_devices, p_channels) AS u(device, channel)
),
sync_latest AS (
SELECT s.device, s.channel, max(s.created) AS sync_created
FROM device_em.sync s
WHERE s.device = ANY(p_devices)
GROUP BY s.device, s.channel
),
dirty AS (
SELECT d.device, d.channel,
count(*)::BIGINT AS rollup_pending,
min(d.first_dirty) AS oldest_rollup_dirty
FROM device_em.rollup_dirty d
WHERE d.device = ANY(p_devices)
GROUP BY d.device, d.channel
)
SELECT
r.device,
r.channel,
s.sync_created,
COALESCE(d.rollup_pending, 0),
d.oldest_rollup_dirty
FROM requested r
LEFT JOIN sync_latest s
ON s.device = r.device
AND s.channel = r.channel
LEFT JOIN dirty d
ON d.device = r.device
AND d.channel IS NOT DISTINCT FROM r.channel
ORDER BY r.device, r.channel;
$function$;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_backlog_stats()
 RETURNS TABLE(state text, reason text, buckets bigint, oldest_age_seconds double precision)
 LANGUAGE sql
 STABLE
AS $function$
WITH blocked AS MATERIALIZED (
SELECT CASE WHEN d.abandoned_at IS NULL THEN 'held' ELSE 'abandoned' END AS state,
d.blocked_reason AS reason,
count(*)::BIGINT AS buckets,
EXTRACT(EPOCH FROM now() - min(d.bucket))::DOUBLE PRECISION AS oldest_age_seconds
FROM device_em.rollup_dirty d
WHERE d.blocked_at IS NOT NULL
GROUP BY 1, 2
)
-- Ready count is the table estimate less the exact blocked count, so the
-- read stays cheap however large a catch-up backlog grows.
SELECT 'ready', NULL::TEXT,
GREATEST(
pg_stat_get_live_tuples('device_em.rollup_dirty'::regclass)
- (SELECT COALESCE(sum(b.buckets), 0) FROM blocked b),
0
)::BIGINT,
COALESCE(
EXTRACT(EPOCH FROM now() - (
SELECT d.first_dirty FROM device_em.rollup_dirty d
WHERE d.blocked_at IS NULL ORDER BY d.id LIMIT 1
)),
0
)::DOUBLE PRECISION
UNION ALL
SELECT b.state, b.reason, b.buckets, b.oldest_age_seconds FROM blocked b;
$function$;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_backlog_in_scope(p_devices integer[], p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(state text, reason text, buckets bigint)
 LANGUAGE sql
 STABLE
AS $function$
SELECT CASE
WHEN d.blocked_at IS NULL THEN 'ready'
WHEN d.abandoned_at IS NULL THEN 'held'
ELSE 'abandoned'
END,
d.blocked_reason,
count(*)::BIGINT
FROM device_em.rollup_dirty d
WHERE d.device = ANY(p_devices)
AND d.bucket >= time_bucket(INTERVAL '15 min', p_from)
AND d.bucket < p_to
GROUP BY 1, 2;
$function$;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty_batch(p_limit integer DEFAULT 500)
 RETURNS TABLE(completed integer, blocked integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
v_bucket TIMESTAMPTZ;
v_ids BIGINT[];
BEGIN
LOCK TABLE ONLY device_em.stats IN ROW EXCLUSIVE MODE;
SELECT d.bucket INTO v_bucket FROM device_em.rollup_dirty d
WHERE d.blocked_at IS NULL ORDER BY d.id FOR UPDATE SKIP LOCKED LIMIT 1;
IF NOT FOUND THEN RETURN QUERY SELECT 0, 0; RETURN; END IF;
SELECT array_agg(c.id ORDER BY c.id) INTO v_ids FROM (
SELECT d.id FROM device_em.rollup_dirty d
WHERE d.bucket=v_bucket AND d.blocked_at IS NULL
ORDER BY d.id FOR UPDATE SKIP LOCKED LIMIT GREATEST(1, p_limit)
) c;
RETURN QUERY SELECT * FROM device_em.fn_project_rollup_keys(v_ids);
END;
$function$;

DROP FUNCTION IF EXISTS device_em.fn_append_stats_synced_batch_v4(
    INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[],
    REAL[], VARCHAR(16), INT[], BIGINT[], INT[], INT[], INT[], INT[],
    BIGINT[], BIGINT[], INT, INT);
DROP FUNCTION IF EXISTS device_em.fn_em_rollup_fire_complete(INT, INT, BIGINT);
DROP FUNCTION IF EXISTS device_em.fn_rollup_due_batch(INT);
DROP FUNCTION IF EXISTS device_em.fn_sync_status_v2(INT[], INT[]);
DROP FUNCTION IF EXISTS device_em.fn_stats_retention_horizon();

CREATE OR REPLACE FUNCTION device_em.fn_append_stats_dirty(p_device integer[], p_tag character varying[], p_domain character varying[], p_phase character varying[], p_channel smallint[], p_ts bigint[], p_val real[], p_source character varying)
 RETURNS TABLE(device integer, tag character varying, domain character varying, phase character varying, channel smallint, ts bigint, val real)
 LANGUAGE sql
AS $function$
WITH ins AS MATERIALIZED (
INSERT INTO device_em.stats
(device, tag, domain, phase, channel, ts, val, source)
SELECT DISTINCT ON
(u.device, u.tag, u.domain, u.phase, u.channel, u._ts)
u.device, u.tag, u.domain, u.phase, u.channel,
to_timestamp(u._ts), u.val, p_source
FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val)
AS u(device, tag, domain, phase, channel, _ts, val)
ORDER BY u.device, u.tag, u.domain, u.phase, u.channel, u._ts
RETURNING device, tag, domain, phase, channel, ts, val
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
)
SELECT i.device, i.tag, i.domain, i.phase, i.channel,
EXTRACT(EPOCH FROM i.ts)::BIGINT, i.val
FROM ins i
CROSS JOIN (SELECT count(*) FROM dirty) ensure_dirty_exec;
$function$;

DROP INDEX IF EXISTS device_em.rollup_dirty_due;
ALTER TABLE device_em.rollup_dirty DROP COLUMN IF EXISTS ready_at;
ALTER TABLE device_em.em_incomplete_range DROP COLUMN IF EXISTS reason;
