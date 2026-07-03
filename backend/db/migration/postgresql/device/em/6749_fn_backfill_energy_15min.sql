--------------UP
-- Backfill mechanism for device_em.energy_15min.
--
-- WHY: energy_15min is maintained forward-only by fn_append_energy_15min as
-- readings arrive. Any tenant that accumulated raw device_em.stats before the
-- rollup existed (or during an ingestion outage) has "holes" — 15-minute
-- buckets that exist in raw stats but were never rolled up. 15-minute and
-- coarser reports read ONLY the rollup, so that history is invisible to them
-- even though the raw data is right there.
--
-- This migration ships three pieces:
--   1. fn_backfill_energy_15min(from, to, tags)  — fill one bounded window
--   2. sp_backfill_energy_15min(...)             — paced driver over a range
--   3. fn_energy_15min_hole_report(from, to, ...)— see where the holes are
-- plus a progress log so a campaign is resumable and never re-scans done work.
--
-- RESOURCE SAFETY (this is the whole point — a careless backfill can saturate
-- a shared TimescaleDB the way an unpruned query did before):
--   * CONSTANT [from,to) bounds on every raw read → TimescaleDB prunes chunks
--     at plan time and touches only the window's chunk(s), never a full scan.
--   * Small windows (default 1 day, smaller than a stats chunk) bound the work,
--     memory and decompression of any single statement.
--   * ON CONFLICT DO NOTHING fills ONLY missing buckets. It never adds to a row
--     the live writer already produced (fn_append_energy_15min ADDS on
--     conflict, so re-feeding would double-count — this path must not). True
--     holes have no conflict, so they insert into the chunk's uncompressed
--     region with no decompression.
--   * Per-statement statement_timeout + lock_timeout cap any runaway.
--   * The driver COMMITs and pg_sleeps between windows, yielding the DB to live
--     ingestion; it is single-threaded and abortable at any window boundary.
--   * A cheap EXISTS pre-check skips windows with no raw data outright.
SET search_path TO device_em, public;

-- Resumability / audit log: one row per completed (window, tag-set). tags_key
-- is the tag-set collapsed to text ('*' = all tags) so the PK is a plain index
-- (no non-IMMUTABLE expression index); the driver fills it explicitly.
CREATE TABLE IF NOT EXISTS device_em.energy_15min_backfill_log (
    window_start  TIMESTAMPTZ NOT NULL,
    window_end    TIMESTAMPTZ NOT NULL,
    tags          VARCHAR(30)[],
    tags_key      TEXT NOT NULL DEFAULT '*',
    rows_inserted BIGINT NOT NULL,
    done_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (window_start, window_end, tags_key)
);

-- ── 1. Per-window hole-fill ────────────────────────────────────────────────
-- Aggregates raw stats in [p_from, p_to) into 15-min buckets EXACTLY as
-- fn_append_energy_15min does (SUM/COUNT/MIN/MAX, GROUP BY bucket, device,
-- phase, channel, tag; domain defaults to 'ac_mains'), then inserts only the
-- buckets not already present. Returns the number of buckets filled.
CREATE OR REPLACE FUNCTION device_em.fn_backfill_energy_15min(
    p_from TIMESTAMPTZ,
    p_to   TIMESTAMPTZ,
    p_tags VARCHAR(30)[] DEFAULT NULL          -- NULL = every tag
)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_inserted BIGINT;
BEGIN
    -- Runaway guards, scoped to the calling transaction.
    SET LOCAL statement_timeout = '120s';
    SET LOCAL lock_timeout       = '5s';
    -- Allow on-the-fly decompression for the aggregate read; window bounds the cost.
    SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, sum_val, sample_count, min_val, max_val)
    SELECT
        time_bucket(INTERVAL '15 min', s.ts),
        s.device, s.phase, s.channel, s.tag,
        SUM(s.val::DOUBLE PRECISION),
        COUNT(*),
        MIN(s.val::DOUBLE PRECISION),
        MAX(s.val::DOUBLE PRECISION)
    FROM device_em.stats s
    WHERE s.ts >= p_from AND s.ts < p_to                 -- constant bounds → chunk pruning
      AND (p_tags IS NULL OR s.tag = ANY (p_tags))
    GROUP BY 1, s.device, s.phase, s.channel, s.tag
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO NOTHING;  -- holes only

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$;

-- ── 2. Paced driver ─────────────────────────────────────────────────────────
-- Walks [p_from, p_to) oldest→newest in p_window steps. Skips windows already
-- logged and windows with no raw data, fills the rest, COMMITs after each, and
-- sleeps p_sleep_ms between windows to yield to live traffic. Abortable at any
-- window boundary; re-running resumes from the log.
CREATE OR REPLACE PROCEDURE device_em.sp_backfill_energy_15min(
    p_from     TIMESTAMPTZ,
    p_to       TIMESTAMPTZ,
    p_window   INTERVAL DEFAULT INTERVAL '1 day',
    p_sleep_ms INTEGER  DEFAULT 1000,
    p_tags     VARCHAR(30)[] DEFAULT NULL
)
LANGUAGE plpgsql
AS
$$
DECLARE
    w_start TIMESTAMPTZ := time_bucket(INTERVAL '15 min', p_from);  -- align to bucket grid
    w_end   TIMESTAMPTZ;
    v_key   TEXT := COALESCE(array_to_string(p_tags, ','), '*');
    n       BIGINT;
    v_has   BOOLEAN;
BEGIN
    WHILE w_start < p_to LOOP
        w_end := LEAST(w_start + p_window, p_to);

        IF EXISTS (SELECT 1 FROM device_em.energy_15min_backfill_log
                   WHERE window_start = w_start AND window_end = w_end
                     AND tags_key = v_key) THEN
            w_start := w_end; CONTINUE;                  -- already done
        END IF;

        -- Cheap chunk-pruned existence probe; skip empty windows without aggregating.
        SELECT EXISTS (SELECT 1 FROM device_em.stats s
                       WHERE s.ts >= w_start AND s.ts < w_end
                         AND (p_tags IS NULL OR s.tag = ANY (p_tags)) LIMIT 1)
          INTO v_has;

        IF v_has THEN
            n := device_em.fn_backfill_energy_15min(w_start, w_end, p_tags);
        ELSE
            n := 0;
        END IF;

        INSERT INTO device_em.energy_15min_backfill_log
            (window_start, window_end, tags, tags_key, rows_inserted)
        VALUES (w_start, w_end, p_tags, v_key, n);
        COMMIT;                                          -- persist progress, drop snapshot/locks
        RAISE NOTICE 'energy_15min backfill % .. %  filled % buckets', w_start, w_end, n;

        PERFORM pg_sleep(p_sleep_ms / 1000.0);           -- throttle
        w_start := w_end;
    END LOOP;
END;
$$;

-- ── 3. Hole report ──────────────────────────────────────────────────────────
-- Per-day coverage over a range: raw device-buckets present vs rollup
-- device-buckets present, and the gap. Bounded by [p_from,p_to) so it prunes
-- chunks; use a modest range. Read-only.
CREATE OR REPLACE FUNCTION device_em.fn_energy_15min_hole_report(
    p_from TIMESTAMPTZ,
    p_to   TIMESTAMPTZ,
    p_tags VARCHAR(30)[] DEFAULT NULL
)
RETURNS TABLE (day DATE, raw_buckets BIGINT, rollup_buckets BIGINT, missing BIGINT)
LANGUAGE sql
STABLE
AS
$$
    WITH raw AS (
        SELECT time_bucket(INTERVAL '1 day', s.ts)::date AS day,
               count(DISTINCT (s.device, s.tag, s.phase, s.channel,
                               time_bucket(INTERVAL '15 min', s.ts))) AS raw_buckets
        FROM device_em.stats s
        WHERE s.ts >= p_from AND s.ts < p_to
          AND (p_tags IS NULL OR s.tag = ANY (p_tags))
        GROUP BY 1
    ),
    roll AS (
        SELECT time_bucket(INTERVAL '1 day', e.bucket)::date AS day,
               count(*) AS rollup_buckets
        FROM device_em.energy_15min e
        WHERE e.bucket >= p_from AND e.bucket < p_to
          AND (p_tags IS NULL OR e.tag = ANY (p_tags))
        GROUP BY 1
    )
    SELECT COALESCE(raw.day, roll.day),
           COALESCE(raw.raw_buckets, 0),
           COALESCE(roll.rollup_buckets, 0),
           GREATEST(COALESCE(raw.raw_buckets, 0) - COALESCE(roll.rollup_buckets, 0), 0)
    FROM raw FULL JOIN roll ON raw.day = roll.day
    ORDER BY 1;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_energy_15min_hole_report(TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR(30)[]);
DROP PROCEDURE IF EXISTS device_em.sp_backfill_energy_15min(TIMESTAMPTZ, TIMESTAMPTZ, INTERVAL, INTEGER, VARCHAR(30)[]);
DROP FUNCTION IF EXISTS device_em.fn_backfill_energy_15min(TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR(30)[]);
DROP TABLE IF EXISTS device_em.energy_15min_backfill_log;
