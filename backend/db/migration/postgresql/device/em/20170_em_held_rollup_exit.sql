-- A bounded exit for held rollup work that keeps its evidence.
--
-- A held rollup key (blocked_reason set) only left device_em.rollup_dirty when
-- new input arrived. Retention took min(bucket) over every queue row, so one
-- held key stopped raw retention for good. Now a held key whose bucket is
-- older than the correction window has its raw rows copied to
-- rollup_held_evidence, is recorded in rollup_abandoned and is marked
-- abandoned_at. Abandoned keys no longer hold back retention. New input for the
-- key clears the mark, so the key is computed again.
--
-- Retention also takes its table lock with lock_timeout and retries, so it can
-- no longer queue every raw insert behind one long writer.
-- Decision: docs/internal/decisions/em-held-rollup-exit.md.
--------------UP
ALTER TABLE device_em.rollup_dirty ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ;

ALTER TABLE device_em.stats_retention
    ADD COLUMN IF NOT EXISTS held_correction_interval INTERVAL NOT NULL
        DEFAULT INTERVAL '7 days'
        CHECK (held_correction_interval > INTERVAL '0');

-- Held and abandoned keys are few; ready keys never enter this index.
CREATE INDEX IF NOT EXISTS rollup_dirty_blocked
    ON device_em.rollup_dirty (blocked_reason, bucket) INCLUDE (abandoned_at)
    WHERE blocked_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS device_em.rollup_abandoned (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bucket            TIMESTAMPTZ NOT NULL,
    device            INT NOT NULL,
    tag               VARCHAR(30) NOT NULL,
    domain            VARCHAR(16) NOT NULL,
    phase             VARCHAR(1),
    channel           SMALLINT,
    blocked_reason    TEXT NOT NULL,
    first_dirty       TIMESTAMPTZ NOT NULL,
    blocked_at        TIMESTAMPTZ NOT NULL,
    correction_window INTERVAL NOT NULL,
    abandoned_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS rollup_abandoned_device_bucket
    ON device_em.rollup_abandoned (device, bucket);

CREATE TABLE IF NOT EXISTS device_em.rollup_held_evidence (
    abandoned_id      BIGINT NOT NULL REFERENCES device_em.rollup_abandoned (id),
    ts                TIMESTAMPTZ NOT NULL,
    device            INT NOT NULL,
    tag               VARCHAR(30) NOT NULL,
    domain            VARCHAR(16) NOT NULL,
    phase             VARCHAR(1),
    channel           SMALLINT,
    val               REAL,
    source            VARCHAR(16),
    sample_period     INT,
    commodity         VARCHAR(12),
    electrical_source VARCHAR(16)
);
CREATE INDEX IF NOT EXISTS rollup_held_evidence_abandoned
    ON device_em.rollup_held_evidence (abandoned_id);

-- New input re-opens a held or abandoned key for computation.
CREATE OR REPLACE FUNCTION device_em.fn_rollup_input_changed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.blocked_at := NULL;
    NEW.blocked_reason := NULL;
    NEW.abandoned_at := NULL;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_configure_held_correction(p_window INTERVAL)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_window IS NULL OR p_window <= INTERVAL '0' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_HELD_CORRECTION_WINDOW';
    END IF;
    UPDATE device_em.stats_retention SET held_correction_interval = p_window
    WHERE singleton AND held_correction_interval IS DISTINCT FROM p_window;
END;
$$;

-- Never waits on a row lock (SKIP LOCKED), so it is safe beside every writer.
CREATE OR REPLACE FUNCTION device_em.fn_abandon_held_rollups(p_limit INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_window INTERVAL;
    v_count INT;
BEGIN
    SELECT held_correction_interval INTO STRICT v_window
    FROM device_em.stats_retention WHERE singleton;
    WITH due AS MATERIALIZED (
        SELECT d.id FROM device_em.rollup_dirty d
        WHERE d.blocked_at IS NOT NULL AND d.abandoned_at IS NULL
          AND d.bucket < now() - v_window
        ORDER BY d.id
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    ), marked AS (
        UPDATE device_em.rollup_dirty d SET abandoned_at = clock_timestamp()
        FROM due WHERE d.id = due.id
        RETURNING d.id, d.bucket, d.device, d.tag, d.domain, d.phase, d.channel,
                  d.blocked_reason, d.first_dirty, d.blocked_at
    ), logged AS (
        INSERT INTO device_em.rollup_abandoned
            (bucket, device, tag, domain, phase, channel, blocked_reason,
             first_dirty, blocked_at, correction_window)
        SELECT m.bucket, m.device, m.tag, m.domain, m.phase, m.channel,
               m.blocked_reason, m.first_dirty, m.blocked_at, v_window
        FROM marked m ORDER BY m.id
        RETURNING id, bucket, device, tag, domain, phase, channel
    ), copied AS (
        INSERT INTO device_em.rollup_held_evidence
            (abandoned_id, ts, device, tag, domain, phase, channel, val, source,
             sample_period, commodity, electrical_source)
        SELECT l.id, s.ts, s.device, s.tag, s.domain, s.phase, s.channel, s.val,
               s.source, s.sample_period, s.commodity, s.electrical_source
        FROM logged l
        JOIN device_em.stats s
          ON s.device = l.device AND s.tag = l.tag AND s.domain = l.domain
         AND s.phase IS NOT DISTINCT FROM l.phase
         AND s.channel IS NOT DISTINCT FROM l.channel
         AND s.ts >= l.bucket AND s.ts < l.bucket + INTERVAL '15 min'
        RETURNING 1
    )
    SELECT count(*)::int INTO v_count
    FROM logged CROSS JOIN (SELECT count(*) FROM copied) ensure_copied;
    RETURN v_count;
END;
$$;

-- One retention pass under the raw table lock. Callers bound the lock waits.
CREATE OR REPLACE FUNCTION device_em.fn_drop_stats_once(p_retention INTERVAL)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS $$
DECLARE
    v_oldest_dirty TIMESTAMPTZ;
    v_horizon TIMESTAMPTZ;
    v_ranges JSONB;
    v_dropped TEXT;
    v_range JSONB;
BEGIN
    -- Parent writes and projection reads take ROW EXCLUSIVE before touching queue keys.
    LOCK TABLE ONLY device_em.stats IN SHARE ROW EXCLUSIVE MODE;
    PERFORM device_em.fn_abandon_held_rollups(NULL);
    SELECT min(bucket) INTO v_oldest_dirty
    FROM device_em.rollup_dirty WHERE abandoned_at IS NULL;
    v_horizon := now() - p_retention;
    IF v_oldest_dirty IS NOT NULL THEN
        v_horizon := LEAST(v_horizon, v_oldest_dirty);
    END IF;

    SELECT jsonb_object_agg(
        format('%I.%I', chunk_schema, chunk_name),
        jsonb_build_array(range_start, range_end)
    ) INTO v_ranges
    FROM timescaledb_information.chunks
    WHERE hypertable_schema = 'device_em' AND hypertable_name = 'stats'
      AND range_end <= v_horizon;

    FOR v_dropped IN
        SELECT drop_chunks('device_em.stats', older_than => v_horizon)::text
    LOOP
        v_range := v_ranges -> v_dropped;
        IF v_range IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'XX000', MESSAGE = 'STATS_EXPIRY_RANGE_MISSING';
        END IF;
        INSERT INTO device_em.stats_expiry (range_start, range_end)
        VALUES ((v_range->>0)::timestamptz, (v_range->>1)::timestamptz);
    END LOOP;
    RETURN v_horizon;
END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_drop_stats_attempts(
    p_retention INTERVAL,
    p_lock_timeout INTERVAL,
    p_attempts INT,
    p_pause INTERVAL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS $$
DECLARE
    v_attempt INT := 0;
    v_previous TEXT := current_setting('lock_timeout');
    v_horizon TIMESTAMPTZ;
BEGIN
    IF p_retention IS NULL OR p_retention <= INTERVAL '0' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_STATS_RETENTION';
    END IF;
    IF p_lock_timeout IS NULL OR p_lock_timeout <= INTERVAL '0'
       OR p_attempts IS NULL OR p_attempts < 1
       OR p_pause IS NULL OR p_pause < INTERVAL '0' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_STATS_RETENTION_LOCK';
    END IF;
    LOOP
        v_attempt := v_attempt + 1;
        BEGIN
            -- A failed attempt rolls back to here, releasing every lock it took.
            PERFORM set_config('lock_timeout',
                ceil(EXTRACT(EPOCH FROM p_lock_timeout) * 1000)::bigint::text, true);
            v_horizon := device_em.fn_drop_stats_once(p_retention);
            PERFORM set_config('lock_timeout', v_previous, true);
            RETURN v_horizon;
        EXCEPTION WHEN lock_not_available THEN
            IF v_attempt >= p_attempts THEN
                RAISE EXCEPTION USING ERRCODE = '55P03', MESSAGE = 'STATS_RETENTION_LOCK_BUSY';
            END IF;
        END;
        PERFORM pg_sleep(EXTRACT(EPOCH FROM p_pause));
    END LOOP;
END;
$$;

-- Each wait for the raw table lock queues new inserts behind it, so keep it short.
CREATE OR REPLACE FUNCTION device_em.fn_drop_stats(p_retention INTERVAL)
RETURNS TIMESTAMPTZ
LANGUAGE sql
AS $$
    SELECT device_em.fn_drop_stats_attempts(
        p_retention, INTERVAL '2 seconds', 6, INTERVAL '5 seconds');
$$;

-- Abandons held work in committed steps outside the raw table lock, so the
-- locked retention pass only finds what became due in the meantime.
CREATE OR REPLACE PROCEDURE device_em.job_retain_stats(job_id INT, config JSONB)
LANGUAGE plpgsql
AS $$
DECLARE
    v_retention INTERVAL;
BEGIN
    WHILE device_em.fn_abandon_held_rollups(1000) = 1000 LOOP
        COMMIT;
    END LOOP;
    COMMIT;
    SELECT retention_interval INTO STRICT v_retention
    FROM device_em.stats_retention WHERE singleton FOR SHARE;
    PERFORM device_em.fn_drop_stats(v_retention);
END;
$$;

-- Strict reports fail fast on held or abandoned work; only ready work can finish.
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

--------------DOWN
-- Abandoned marks, records and evidence stay: they are the recovery evidence.
-- Restored retention ignores the marks, so abandoned keys hold it back again.
DROP FUNCTION IF EXISTS device_em.fn_rollup_backlog_in_scope(INT[], TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE PROCEDURE device_em.job_retain_stats(job_id INT, config JSONB)
LANGUAGE plpgsql
AS $$
DECLARE
    v_retention INTERVAL;
BEGIN
    SELECT retention_interval INTO STRICT v_retention
    FROM device_em.stats_retention WHERE singleton FOR SHARE;
    PERFORM device_em.fn_drop_stats(v_retention);
END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_drop_stats(p_retention INTERVAL)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS $$
DECLARE
    v_oldest_dirty TIMESTAMPTZ;
    v_horizon TIMESTAMPTZ;
    v_ranges JSONB;
    v_dropped TEXT;
    v_range JSONB;
BEGIN
    IF p_retention IS NULL OR p_retention <= INTERVAL '0' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_STATS_RETENTION';
    END IF;
    -- Parent writes and projection reads take ROW EXCLUSIVE before touching queue keys.
    LOCK TABLE ONLY device_em.stats IN SHARE ROW EXCLUSIVE MODE;
    SELECT min(bucket) INTO v_oldest_dirty FROM device_em.rollup_dirty;
    v_horizon := now() - p_retention;
    IF v_oldest_dirty IS NOT NULL THEN
        v_horizon := LEAST(v_horizon, v_oldest_dirty);
    END IF;

    SELECT jsonb_object_agg(
        format('%I.%I', chunk_schema, chunk_name),
        jsonb_build_array(range_start, range_end)
    ) INTO v_ranges
    FROM timescaledb_information.chunks
    WHERE hypertable_schema = 'device_em' AND hypertable_name = 'stats'
      AND range_end <= v_horizon;

    FOR v_dropped IN
        SELECT drop_chunks('device_em.stats', older_than => v_horizon)::text
    LOOP
        v_range := v_ranges -> v_dropped;
        IF v_range IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'XX000', MESSAGE = 'STATS_EXPIRY_RANGE_MISSING';
        END IF;
        INSERT INTO device_em.stats_expiry (range_start, range_end)
        VALUES ((v_range->>0)::timestamptz, (v_range->>1)::timestamptz);
    END LOOP;
    RETURN v_horizon;
END;
$$;

DROP FUNCTION IF EXISTS device_em.fn_drop_stats_attempts(INTERVAL, INTERVAL, INT, INTERVAL);
DROP FUNCTION IF EXISTS device_em.fn_drop_stats_once(INTERVAL);
DROP FUNCTION IF EXISTS device_em.fn_abandon_held_rollups(INT);
DROP FUNCTION IF EXISTS device_em.fn_configure_held_correction(INTERVAL);

CREATE OR REPLACE FUNCTION device_em.fn_rollup_input_changed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.blocked_at := NULL;
    NEW.blocked_reason := NULL;
    RETURN NEW;
END;
$$;
