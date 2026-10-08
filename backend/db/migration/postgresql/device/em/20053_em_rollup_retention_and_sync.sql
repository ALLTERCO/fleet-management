-- EM rollup, retention and sync, as one migration.
--
-- This was drafted across five files that never shipped. Three of their
-- definitions never ran: fn_rollup_dirty was written, then rewritten twice, and
-- fn_append_energy_15min was written, then rewritten. Only the surviving
-- version of each is here. A throwaway database proved this file produces a
-- byte-identical device_em schema to that draft sequence: same 69 functions,
-- 130 columns and indexes.
--
-- Behaviour settled here: a bucket with no raw samples does NOT delete its
-- rollup. Retention drops raw chunks on a schedule (fn_drop_stats below calls
-- drop_chunks), so treating "no raw input" as "delete the projection" would
-- erase exactly the history the rollup exists to preserve. Such a bucket is
-- parked with blocked_reason 'missing_input' instead. Seed cleanup, which does
-- want its projections gone, must delete its own energy_15min rows; it knows it
-- is removing demo data and the rollup queue cannot tell that apart.
--------------UP
-- from 20053_seed_rollups_via_dirty_queue.sql
--------------UP
-- Queue claims serialize projection changes without blocking raw ingestion on rollup locks.
CREATE OR REPLACE FUNCTION device_em.fn_mark_energy_15min_dirty(
    p_device INT[], p_tag VARCHAR(30)[], p_domain VARCHAR(16)[],
    p_phase VARCHAR(1)[], p_channel SMALLINT[], p_ts BIGINT[]
)
RETURNS void
LANGUAGE sql
AS $$
    INSERT INTO device_em.rollup_dirty
        (bucket, device, tag, domain, phase, channel)
    SELECT DISTINCT time_bucket(INTERVAL '15 min', to_timestamp(u.ts)),
           u.device, u.tag, u.domain, u.phase, u.channel
    FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts)
         AS u(device, tag, domain, phase, channel, ts)
    ORDER BY 1, 2, 3, 4, 5, 6
    ON CONFLICT (bucket, device, tag, domain, phase, channel)
        DO UPDATE SET last_dirty = now();
$$;

-- from 20054_rollup_bounded_work.sql
--------------UP
-- Preserve original cleanup schedules and execution evidence across the maintenance restart.
CREATE TABLE IF NOT EXISTS device_em.stats_retention_legacy (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    guard_config JSONB,
    guard_interval INTERVAL,
    guard_scheduled BOOLEAN,
    blind_interval INTERVAL,
    prepared_at TIMESTAMPTZ NOT NULL,
    prepared_postmaster_start TIMESTAMPTZ NOT NULL,
    cleanup_jobs JSONB NOT NULL
);

CREATE OR REPLACE FUNCTION device_em.fn_stats_cleanup_snapshot()
RETURNS JSONB LANGUAGE sql STABLE SET timezone TO 'UTC' AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'job_id', j.job_id, 'proc_schema', j.proc_schema, 'proc_name', j.proc_name,
        'config', j.config, 'schedule_interval', j.schedule_interval,
        'scheduled', j.scheduled, 'hypertable_schema', j.hypertable_schema,
        'hypertable_name', j.hypertable_name, 'total_runs', s.total_runs,
        'last_run_started_at', s.last_run_started_at,
        'last_successful_finish', s.last_successful_finish,
        'last_run_status', s.last_run_status
    ) ORDER BY j.job_id), '[]'::jsonb)
    FROM timescaledb_information.jobs j
    LEFT JOIN timescaledb_information.job_stats s USING (job_id)
    WHERE (j.proc_schema='device_em' AND j.proc_name='job_retain_stats')
       OR (j.hypertable_schema='device_em' AND j.hypertable_name='stats'
           AND j.proc_name='policy_retention');
$$;

DO $$
DECLARE
    v_jobs JSONB;
    v_guard JSONB;
    v_blind JSONB;
    v_job JSONB;
BEGIN
    v_jobs := device_em.fn_stats_cleanup_snapshot();
    SELECT j INTO v_guard FROM jsonb_array_elements(v_jobs) j
    WHERE j->>'proc_schema'='device_em' AND j->>'proc_name'='job_retain_stats';
    SELECT j INTO v_blind FROM jsonb_array_elements(v_jobs) j
    WHERE j->>'proc_name'='policy_retention';
    INSERT INTO device_em.stats_retention_legacy
        (guard_config, guard_interval, guard_scheduled, blind_interval,
         prepared_at, prepared_postmaster_start, cleanup_jobs)
    VALUES (v_guard->'config', (v_guard->>'schedule_interval')::interval,
        (v_guard->>'scheduled')::boolean, (v_blind->'config'->>'drop_after')::interval,
        clock_timestamp(), pg_postmaster_start_time(), v_jobs)
    ON CONFLICT (singleton) DO NOTHING;
    FOR v_job IN SELECT * FROM jsonb_array_elements(v_jobs) LOOP
        PERFORM alter_job((v_job->>'job_id')::int, scheduled => FALSE);
    END LOOP;
END;
$$;

-- A single claimed period avoids decompressing gaps between unrelated historical work.

-- from 20055_coordinated_stats_retention.sql
--------------UP
CREATE TABLE IF NOT EXISTS device_em.stats_retention (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    retention_interval INTERVAL NOT NULL CHECK (retention_interval > INTERVAL '0'),
    source_available_from TIMESTAMPTZ,
    initialized_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS device_em.stats_expiry (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    range_start TIMESTAMPTZ NOT NULL,
    range_end TIMESTAMPTZ NOT NULL,
    expired_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (range_start < range_end)
);
CREATE INDEX IF NOT EXISTS stats_expiry_range ON device_em.stats_expiry (range_start, range_end);

-- A new database boot and unchanged execution records close the scheduler pause race.
CREATE OR REPLACE FUNCTION device_em.fn_stats_legacy_source_boundary()
RETURNS TIMESTAMPTZ LANGUAGE plpgsql AS $$
DECLARE
    v_legacy device_em.stats_retention_legacy%ROWTYPE;
    v_current JSONB;
    v_saved JSONB;
    v_job JSONB;
    v_finish TIMESTAMPTZ;
    v_boundary TIMESTAMPTZ;
    v_retention INTERVAL;
BEGIN
    SELECT * INTO v_legacy FROM device_em.stats_retention_legacy WHERE singleton;
    IF NOT FOUND OR pg_postmaster_start_time() <= v_legacy.prepared_at
       OR pg_postmaster_start_time() = v_legacy.prepared_postmaster_start
       OR jsonb_array_length(v_legacy.cleanup_jobs)=0 THEN
        RETURN NULL;
    END IF;
    v_current := device_em.fn_stats_cleanup_snapshot();
    IF jsonb_array_length(v_current) <> jsonb_array_length(v_legacy.cleanup_jobs) THEN
        RETURN NULL;
    END IF;
    FOR v_saved IN SELECT * FROM jsonb_array_elements(v_legacy.cleanup_jobs) LOOP
        SELECT j INTO v_job FROM jsonb_array_elements(v_current) j
        WHERE j->>'job_id'=v_saved->>'job_id';
        IF v_job IS NULL OR (v_job->>'scheduled')::boolean IS DISTINCT FROM FALSE
           OR (v_job-'scheduled') IS DISTINCT FROM (v_saved-'scheduled')
           OR v_saved->>'last_run_status' IS DISTINCT FROM 'Success'
           OR COALESCE((v_saved->>'total_runs')::bigint, 0) <= 0 THEN
            RETURN NULL;
        END IF;
        v_finish := (v_saved->>'last_successful_finish')::timestamptz;
        IF v_finish IS NULL OR NOT isfinite(v_finish)
           OR v_finish < (v_saved->>'last_run_started_at')::timestamptz
           OR v_saved->>'last_run_started_at' IS NULL
           OR v_finish > v_legacy.prepared_at THEN
            RETURN NULL;
        END IF;
        v_retention := CASE WHEN v_saved->>'proc_name'='policy_retention'
            THEN (v_saved->'config'->>'drop_after')::interval
            ELSE COALESCE((v_saved->'config'->>'retention_interval')::interval,
                make_interval(days => (v_saved->'config'->>'retention_days')::int)) END;
        IF v_retention IS NULL OR v_retention <= INTERVAL '0' THEN RETURN NULL; END IF;
        v_boundary := GREATEST(v_boundary, v_finish);
    END LOOP;
    RETURN v_boundary;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_stats_retention_interval()
RETURNS INTERVAL
LANGUAGE sql
STABLE
AS $$
    SELECT retention_interval FROM device_em.stats_retention WHERE singleton;
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

CREATE OR REPLACE FUNCTION device_em.fn_drop_rolled_up_stats(p_retention_days INT DEFAULT 31)
RETURNS TIMESTAMPTZ
LANGUAGE sql
AS $$
    SELECT device_em.fn_drop_stats(make_interval(days => p_retention_days));
$$;

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

CREATE OR REPLACE FUNCTION device_em.fn_configure_stats_retention(p_retention INTERVAL)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_job INT;
    v_count INT;
    v_clear_config BOOLEAN;
BEGIN
    IF p_retention IS NULL OR p_retention <= INTERVAL '0' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_STATS_RETENTION';
    END IF;
    LOCK TABLE ONLY device_em.stats_retention IN SHARE ROW EXCLUSIVE MODE;
    SELECT count(*)::int, min(job_id), bool_or(config IS DISTINCT FROM '{}'::jsonb)
    INTO v_count, v_job, v_clear_config
    FROM timescaledb_information.jobs
    WHERE proc_schema = 'device_em' AND proc_name = 'job_retain_stats';
    IF v_count > 1 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MULTIPLE_STATS_RETENTION_JOBS';
    END IF;
    PERFORM remove_retention_policy('device_em.stats', if_exists => TRUE);
    IF v_job IS NULL THEN
        PERFORM add_job('device_em.job_retain_stats', INTERVAL '1 day', config => '{}'::jsonb);
    ELSIF v_clear_config THEN
        PERFORM alter_job(v_job, config => '{}'::jsonb);
    END IF;
    INSERT INTO device_em.stats_retention (retention_interval) VALUES (p_retention)
    ON CONFLICT (singleton) DO UPDATE SET retention_interval = EXCLUDED.retention_interval
    WHERE device_em.stats_retention.retention_interval IS DISTINCT FROM EXCLUDED.retention_interval;
END;
$$;

DO $$
DECLARE
    v_config JSONB;
    v_schedule INTERVAL;
    v_scheduled BOOLEAN;
    v_blind INTERVAL;
    v_count INT;
    v_interval INTERVAL;
    v_boundary TIMESTAMPTZ;
    v_legacy device_em.stats_retention_legacy%ROWTYPE;
    v_job INT;
BEGIN
    SELECT count(*)::int INTO v_count FROM timescaledb_information.jobs
    WHERE proc_schema = 'device_em' AND proc_name = 'job_retain_stats';
    IF v_count > 1 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MULTIPLE_STATS_RETENTION_JOBS';
    END IF;
    SELECT config, schedule_interval, scheduled INTO v_config, v_schedule, v_scheduled
    FROM timescaledb_information.jobs
    WHERE proc_schema = 'device_em' AND proc_name = 'job_retain_stats';
    SELECT (config->>'drop_after')::interval INTO v_blind
    FROM timescaledb_information.jobs
    WHERE hypertable_schema = 'device_em' AND hypertable_name = 'stats'
      AND proc_name = 'policy_retention';
    v_interval := COALESCE(
        (v_config->>'retention_interval')::interval,
        make_interval(days => (v_config->>'retention_days')::int),
        v_blind, device_em.fn_stats_retention_interval(), INTERVAL '31 days'
    );
    SELECT * INTO STRICT v_legacy FROM device_em.stats_retention_legacy WHERE singleton;
    v_boundary := device_em.fn_stats_legacy_source_boundary();
    PERFORM device_em.fn_configure_stats_retention(v_interval);
    UPDATE device_em.stats_retention SET source_available_from=v_boundary
    WHERE singleton AND source_available_from IS NULL AND v_boundary IS NOT NULL;
    SELECT job_id INTO v_job FROM timescaledb_information.jobs
    WHERE proc_schema='device_em' AND proc_name='job_retain_stats';
    IF v_legacy.guard_scheduled IS NOT NULL THEN
        PERFORM alter_job(v_job, scheduled => v_legacy.guard_scheduled);
    END IF;
END;
$$;

-- from 20056_em_sync_record_period.sql
--------------UP
-- Missing legacy periods remain unknown rather than becoming invented coverage.
ALTER TABLE device_em.stats ADD COLUMN IF NOT EXISTS sample_period INT
    CHECK (sample_period > 0);

CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch_v2(
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
    p_period        INT[]
)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_count BIGINT;
BEGIN
    IF p_period IS NOT NULL AND (
        cardinality(p_period) <> cardinality(p_ts)
        OR EXISTS (SELECT 1 FROM unnest(p_period) p WHERE p <= 0)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EM_SYNC_PERIOD_INVALID';
    END IF;
    WITH ins AS MATERIALIZED (
        INSERT INTO device_em.stats
            (device, tag, domain, phase, channel, ts, val, source, sample_period)
        SELECT DISTINCT ON
               (u.device, u.tag, u.domain, u.phase, u.channel, u._ts, u.val, u.period)
               u.device, u.tag, u.domain, u.phase, u.channel,
               to_timestamp(u._ts), u.val, p_source, u.period
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val, p_period)
             AS u(device, tag, domain, phase, channel, _ts, val, period)
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
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch(
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
    p_sync_channel  INT[]
)
RETURNS BIGINT
LANGUAGE sql
AS
$$
    SELECT device_em.fn_append_stats_synced_batch_v2(
        p_device, p_tag, p_domain, p_phase, p_channel, p_ts, p_val, p_source,
        p_sync_device, p_sync_created, p_sync_channel, NULL::int[]);
$$;

-- from 20057_guard_historical_rollup.sql
--------------UP
ALTER TABLE device_em.energy_15min ADD COLUMN IF NOT EXISTS source_kind VARCHAR(16);
ALTER TABLE device_em.energy_15min ADD COLUMN IF NOT EXISTS source_expiry_id BIGINT;
ALTER TABLE device_em.rollup_dirty ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE device_em.rollup_dirty ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
CREATE INDEX IF NOT EXISTS rollup_dirty_ready_id ON device_em.rollup_dirty (id) WHERE blocked_at IS NULL;
CREATE INDEX IF NOT EXISTS rollup_dirty_ready_bucket ON device_em.rollup_dirty (bucket, id) WHERE blocked_at IS NULL;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_input_changed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.blocked_at := NULL;
    NEW.blocked_reason := NULL;
    RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER rollup_input_changed
BEFORE UPDATE OF last_dirty ON device_em.rollup_dirty
FOR EACH ROW EXECUTE FUNCTION device_em.fn_rollup_input_changed();

-- Both projection entry points share one calculation and one safety decision.
CREATE OR REPLACE FUNCTION device_em.fn_project_rollup_keys(p_ids BIGINT[], p_missing_only BOOLEAN DEFAULT FALSE)
RETURNS TABLE(completed INT, blocked INT)
LANGUAGE plpgsql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS $$
DECLARE
    v_from TIMESTAMPTZ;
    v_to TIMESTAMPTZ;
    v_expiry BIGINT;
    v_source_available_from TIMESTAMPTZ;
BEGIN
    LOCK TABLE ONLY device_em.stats IN ROW EXCLUSIVE MODE;
    PERFORM d.id FROM device_em.rollup_dirty d WHERE d.id = ANY(p_ids) ORDER BY d.id FOR UPDATE;
    SELECT min(bucket), max(bucket) INTO v_from, v_to
    FROM device_em.rollup_dirty WHERE id = ANY(p_ids);
    IF v_from IS NULL THEN RETURN QUERY SELECT 0, 0; RETURN; END IF;
    IF v_from <> v_to THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EM_ROLLUP_MULTIPLE_PERIODS';
    END IF;
    v_to := v_from + INTERVAL '15 min';
    SELECT COALESCE(max(id), 0) INTO v_expiry FROM device_em.stats_expiry
    WHERE range_start < v_to AND range_end > v_from;

    SELECT source_available_from INTO v_source_available_from
    FROM device_em.stats_retention WHERE singleton;

    RETURN QUERY EXECUTE $project$
    WITH claimed AS MATERIALIZED (
        SELECT * FROM device_em.rollup_dirty WHERE id = ANY($1)
    ), facts AS MATERIALIZED (
        SELECT c.*, r.*, e.source_kind AS saved_source, e.source_expiry_id AS saved_expiry,
               e.bucket IS NOT NULL AS saved_exists
        FROM claimed c
        CROSS JOIN LATERAL (
            WITH raw AS MATERIALIZED (
                SELECT s.ts, s.val, s.source, s.sample_period
                FROM device_em.stats s
                WHERE s.ts >= $2 AND s.ts < $3
                  AND s.device=c.device AND s.tag=c.tag AND s.domain=c.domain
                  AND s.phase IS NOT DISTINCT FROM c.phase
                  AND s.channel IS NOT DISTINCT FROM c.channel
            ), chosen AS (
                SELECT * FROM raw
                WHERE source='em_sync' OR NOT EXISTS (SELECT 1 FROM raw WHERE source='em_sync')
            ), readings AS (
                SELECT ts, min(val::double precision) AS val, max(sample_period) AS period,
                       bool_or(source='em_sync') AS synced,
                       count(DISTINCT val) > 1 OR count(DISTINCT sample_period) > 1
                         OR bool_or(val IS NULL OR val IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real)) AS conflict
                FROM chosen GROUP BY ts
            )
            SELECT sum(val) AS sum_val, count(*) AS sample_count, min(val) AS min_val, max(val) AS max_val,
                   CASE WHEN bool_or(synced) THEN 'em_sync' ELSE 'live' END AS input_source,
                   COALESCE(bool_or(conflict), false) AS conflict,
                   (SELECT bool_and(source='em_sync' AND source IS NOT NULL)
                        OR bool_and(source='live' AND source IS NOT NULL) FROM raw) AS single_source,
                   COALESCE(
                       bool_and(synced AND period IS NOT NULL)
                       AND sum(period::bigint)=EXTRACT(EPOCH FROM $3::timestamptz-$2::timestamptz)
                       AND range_agg(tstzrange(ts, ts + period * INTERVAL '1 second', '[)'))
                           = tstzmultirange(tstzrange($2, $3, '[)')),
                       false
                   ) AS full_sync
            FROM readings
        ) r
        LEFT JOIN device_em.energy_15min e
          ON e.bucket=$2 AND e.device=c.device AND e.tag=c.tag AND e.domain=c.domain
         AND e.phase IS NOT DISTINCT FROM c.phase AND e.channel IS NOT DISTINCT FROM c.channel
    ), decisions AS MATERIALIZED (
        SELECT f.*, CASE
            WHEN sample_count=0 THEN 'missing_input'
            WHEN conflict THEN 'conflicting_input'
            WHEN full_sync THEN NULL
            WHEN NOT saved_exists AND $4=0 THEN NULL
            WHEN saved_source IS NULL AND saved_expiry IS NULL AND $4=0
                 AND bucket >= $6 AND single_source THEN NULL
            WHEN saved_expiry=$4 AND saved_source=input_source THEN NULL
            ELSE 'incomplete_history'
        END AS reason
        FROM facts f WHERE NOT $5 OR NOT f.saved_exists
    ), saved AS (
        INSERT INTO device_em.energy_15min
            (bucket, device, tag, domain, phase, channel,
             sum_val, sample_count, min_val, max_val, source_kind, source_expiry_id)
        SELECT bucket, device, tag, domain, phase, channel,
               sum_val, sample_count, min_val, max_val, input_source, $4
        FROM decisions WHERE reason IS NULL
        ORDER BY bucket, device, tag, domain, phase, channel
        ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
        SET sum_val=EXCLUDED.sum_val, sample_count=EXCLUDED.sample_count,
            min_val=EXCLUDED.min_val, max_val=EXCLUDED.max_val,
            source_kind=EXCLUDED.source_kind, source_expiry_id=EXCLUDED.source_expiry_id
        RETURNING 1
    ), held AS (
        UPDATE device_em.rollup_dirty d
        SET blocked_at=clock_timestamp(), blocked_reason=c.reason
        FROM decisions c WHERE d.id=c.id AND c.reason IS NOT NULL
        RETURNING 1
    ), done AS (
        DELETE FROM device_em.rollup_dirty d USING decisions c
        WHERE d.id=c.id AND c.reason IS NULL RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM done), (SELECT count(*)::int FROM held)
    FROM (SELECT count(*) FROM saved) ensure_saved
    $project$ USING p_ids, v_from, v_to, v_expiry, p_missing_only, v_source_available_from;
END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty_batch(p_limit INT DEFAULT 500)
RETURNS TABLE(completed INT, blocked INT)
LANGUAGE plpgsql AS $$
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
$$;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty(p_limit INT DEFAULT 500)
RETURNS INT LANGUAGE sql AS $$
    SELECT completed FROM device_em.fn_rollup_dirty_batch(p_limit);
$$;

CREATE OR REPLACE FUNCTION device_em.fn_append_energy_15min(
    p_device INT[], p_tag VARCHAR(30)[], p_domain VARCHAR(16)[],
    p_phase VARCHAR(1)[], p_channel SMALLINT[], p_ts BIGINT[], p_val REAL[]
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_ids BIGINT[];
    v_period RECORD;
BEGIN
    LOCK TABLE ONLY device_em.stats IN ROW EXCLUSIVE MODE;
    WITH marked AS (
        INSERT INTO device_em.rollup_dirty (bucket, device, tag, domain, phase, channel)
        SELECT DISTINCT time_bucket(INTERVAL '15 min', to_timestamp(u.ts)),
               u.device, u.tag, u.domain, u.phase, u.channel
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts)
             u(device, tag, domain, phase, channel, ts)
        ORDER BY 1, 2, 3, 4, 5, 6
        ON CONFLICT (bucket, device, tag, domain, phase, channel)
        DO UPDATE SET last_dirty=now()
        RETURNING id
    )
    SELECT array_agg(id) INTO v_ids FROM marked;
    FOR v_period IN
        SELECT bucket, array_agg(id ORDER BY id) AS ids
        FROM device_em.rollup_dirty WHERE id=ANY(v_ids)
        GROUP BY bucket ORDER BY bucket
    LOOP
        PERFORM * FROM device_em.fn_project_rollup_keys(v_period.ids);
    END LOOP;
END;
$$;


CREATE OR REPLACE FUNCTION device_em.fn_backfill_energy_15min(
    p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[] DEFAULT NULL
)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
    v_ids BIGINT[];
    v_period RECORD;
    v_completed INT;
    v_total BIGINT := 0;
BEGIN
    SET LOCAL statement_timeout = '120s';
    SET LOCAL lock_timeout = '5s';
    LOCK TABLE ONLY device_em.stats IN ROW EXCLUSIVE MODE;
    WITH keys AS (
        SELECT DISTINCT time_bucket(INTERVAL '15 min', s.ts) AS bucket,
               s.device, s.tag, s.domain, s.phase, s.channel
        FROM device_em.stats s
        WHERE s.ts >= p_from AND s.ts < p_to AND (p_tags IS NULL OR s.tag=ANY(p_tags))
    ), marked AS (
        INSERT INTO device_em.rollup_dirty (bucket, device, tag, domain, phase, channel)
        SELECT k.bucket, k.device, k.tag, k.domain, k.phase, k.channel FROM keys k
        WHERE NOT EXISTS (
            SELECT 1 FROM device_em.energy_15min e
            WHERE e.bucket=k.bucket AND e.device=k.device AND e.tag=k.tag AND e.domain=k.domain
              AND e.phase IS NOT DISTINCT FROM k.phase AND e.channel IS NOT DISTINCT FROM k.channel
        )
        ORDER BY k.bucket, k.device, k.tag, k.domain, k.phase, k.channel
        ON CONFLICT (bucket, device, tag, domain, phase, channel)
        DO UPDATE SET last_dirty=now()
        RETURNING id
    )
    SELECT array_agg(id) INTO v_ids FROM marked;
    FOR v_period IN
        SELECT bucket, array_agg(id ORDER BY id) AS ids
        FROM device_em.rollup_dirty WHERE id=ANY(v_ids) GROUP BY bucket ORDER BY bucket
    LOOP
        SELECT completed INTO v_completed FROM device_em.fn_project_rollup_keys(v_period.ids, TRUE);
        v_total := v_total + v_completed;
    END LOOP;
    RETURN v_total;
END;
$$;

--------------DOWN
-- undo 20057_guard_historical_rollup.sql
-- Keep accepted provenance and held work available for recovery.

-- A single claimed period avoids decompressing gaps between unrelated historical work.
CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty(p_limit INT DEFAULT 500)
RETURNS INT
LANGUAGE plpgsql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
DECLARE
    v_claimed_ids BIGINT[];
    v_done        INT;
    v_from        TIMESTAMPTZ;
    v_to          TIMESTAMPTZ;
    v_devices     INT[];
    v_tags        VARCHAR(30)[];
BEGIN
    -- Keep retention behind the complete claim, read and projection transaction.
    LOCK TABLE ONLY device_em.stats IN ROW EXCLUSIVE MODE;
    SELECT d.bucket INTO v_from
    FROM device_em.rollup_dirty d
    ORDER BY d.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    SELECT array_agg(c.id ORDER BY c.id)
    INTO v_claimed_ids
    FROM (
        SELECT d.id
        FROM device_em.rollup_dirty d
        WHERE d.bucket = v_from
        ORDER BY d.id
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, p_limit)
    ) c;

    IF COALESCE(cardinality(v_claimed_ids), 0) = 0 THEN
        RETURN 0;
    END IF;

    v_to := v_from + INTERVAL '15 min';
    SELECT array_agg(DISTINCT d.device), array_agg(DISTINCT d.tag)
    INTO v_devices, v_tags
    FROM device_em.rollup_dirty d
    WHERE d.id = ANY(v_claimed_ids);

    EXECUTE $rollup$
    WITH claimed AS MATERIALIZED (
        SELECT d.id, d.bucket, d.device, d.tag, d.domain, d.phase, d.channel
        FROM device_em.rollup_dirty d
        WHERE d.id = ANY($1)
    ),
    recomputed AS MATERIALIZED (
        SELECT
            c.bucket, c.device, c.tag, c.domain, c.phase, c.channel,
            SUM(v.val) AS sum_val,
            COUNT(*) AS sample_count,
            MIN(v.val) AS min_val,
            MAX(v.val) AS max_val
        FROM claimed c
        CROSS JOIN LATERAL (
            SELECT bool_or(g.source = 'em_sync') AS has_emsync
            FROM device_em.stats g
            WHERE g.device = c.device
              AND g.tag = c.tag
              AND g.domain = c.domain
              AND g.phase IS NOT DISTINCT FROM c.phase
              AND g.channel IS NOT DISTINCT FROM c.channel
              AND g.ts >= c.bucket
              AND g.ts < c.bucket + INTERVAL '15 min'
        ) gate
        CROSS JOIN LATERAL (
            SELECT DISTINCT ON (s.ts) s.val::DOUBLE PRECISION AS val
            FROM device_em.stats s
            WHERE s.device = c.device
              AND s.tag = c.tag
              AND s.domain = c.domain
              AND s.phase IS NOT DISTINCT FROM c.phase
              AND s.channel IS NOT DISTINCT FROM c.channel
              AND s.ts >= c.bucket
              AND s.ts < c.bucket + INTERVAL '15 min'
              AND CASE
                      WHEN COALESCE(gate.has_emsync, FALSE)
                          THEN s.source = 'em_sync'
                      ELSE TRUE
                  END
            ORDER BY s.ts
        ) v
        GROUP BY c.bucket, c.device, c.tag, c.domain, c.phase, c.channel
    ),
    upserted AS (
        INSERT INTO device_em.energy_15min
            (bucket, device, phase, channel, tag, domain,
             sum_val, sample_count, min_val, max_val)
        SELECT bucket, device, phase, channel, tag, domain,
               sum_val, sample_count, min_val, max_val
        FROM recomputed
        ORDER BY bucket, device, tag, domain, phase, channel
        ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
        SET sum_val = EXCLUDED.sum_val,
            sample_count = EXCLUDED.sample_count,
            min_val = EXCLUDED.min_val,
            max_val = EXCLUDED.max_val
        RETURNING 1
    ),
    empty_deleted AS (
        DELETE FROM device_em.energy_15min e
        USING claimed c
        WHERE e.bucket >= $2 AND e.bucket < $3
          AND e.device = ANY($4) AND e.tag = ANY($5)
          AND e.bucket = c.bucket AND e.device = c.device
          AND e.tag = c.tag AND e.domain = c.domain
          AND e.phase IS NOT DISTINCT FROM c.phase
          AND e.channel IS NOT DISTINCT FROM c.channel
          AND NOT EXISTS (
              SELECT 1 FROM recomputed r
              WHERE r.bucket = c.bucket AND r.device = c.device
                AND r.tag = c.tag AND r.domain = c.domain
                AND r.phase IS NOT DISTINCT FROM c.phase
                AND r.channel IS NOT DISTINCT FROM c.channel
          )
        RETURNING 1
    ),
    deleted AS (
        DELETE FROM device_em.rollup_dirty d
        USING claimed c
        WHERE d.id = c.id
        RETURNING 1
    )
    SELECT count(*)::INT
    FROM deleted
    CROSS JOIN (SELECT count(*) FROM upserted) ensure_upsert_exec
    CROSS JOIN (SELECT count(*) FROM empty_deleted) ensure_empty_delete_exec
    $rollup$ INTO v_done USING v_claimed_ids, v_from, v_to, v_devices, v_tags;

    RETURN v_done;
END;
$$;



CREATE OR REPLACE FUNCTION device_em.fn_append_energy_15min(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_domain  VARCHAR(16)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
)
RETURNS void
LANGUAGE plpgsql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
BEGIN
    LOCK TABLE ONLY device_em.stats IN ROW EXCLUSIVE MODE;
    WITH affected AS (
        SELECT DISTINCT
            time_bucket(INTERVAL '15 min', to_timestamp(u._ts)) AS bucket,
            u.device, u.tag, u.domain, u.phase, u.channel
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts)
             AS u(device, tag, domain, phase, channel, _ts)
    ),
    recomputed AS (
        SELECT
            a.bucket, a.device, a.tag, a.domain, a.phase, a.channel,
            SUM(d.val)   AS sum_val,
            COUNT(*)     AS sample_count,
            MIN(d.val)   AS min_val,
            MAX(d.val)   AS max_val
        FROM affected a
        CROSS JOIN LATERAL (
            SELECT bool_or(g.source = 'em_sync') AS has_emsync
            FROM device_em.stats g
            WHERE g.device  = a.device
              AND g.tag     = a.tag
              AND g.domain  = a.domain
              AND g.phase   IS NOT DISTINCT FROM a.phase
              AND g.channel IS NOT DISTINCT FROM a.channel
              AND g.ts >= a.bucket
              AND g.ts <  a.bucket + INTERVAL '15 min'
        ) gate
        CROSS JOIN LATERAL (
            SELECT DISTINCT ON (s.ts) s.val::DOUBLE PRECISION AS val
            FROM device_em.stats s
            WHERE s.device  = a.device
              AND s.tag     = a.tag
              AND s.domain  = a.domain
              AND s.phase   IS NOT DISTINCT FROM a.phase
              AND s.channel IS NOT DISTINCT FROM a.channel
              AND s.ts >= a.bucket
              AND s.ts <  a.bucket + INTERVAL '15 min'
              AND CASE
                      WHEN COALESCE(gate.has_emsync, FALSE)
                          THEN s.source = 'em_sync'
                      ELSE TRUE
                  END
            ORDER BY s.ts
        ) d
        GROUP BY a.bucket, a.device, a.tag, a.domain, a.phase, a.channel
    )
    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, domain,
         sum_val, sample_count, min_val, max_val)
    SELECT
        bucket, device, phase, channel, tag, domain,
        sum_val, sample_count, min_val, max_val
    FROM recomputed
    ORDER BY bucket, device, tag, domain, phase, channel
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = EXCLUDED.sum_val,
        sample_count = EXCLUDED.sample_count,
        min_val      = EXCLUDED.min_val,
        max_val      = EXCLUDED.max_val;
END;
$$;


CREATE OR REPLACE FUNCTION device_em.fn_backfill_energy_15min(
    p_from TIMESTAMPTZ,
    p_to   TIMESTAMPTZ,
    p_tags VARCHAR(30)[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_inserted BIGINT;
BEGIN
    SET LOCAL statement_timeout = '120s';
    SET LOCAL lock_timeout       = '5s';
    SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, domain, sum_val, sample_count, min_val, max_val)
    SELECT
        time_bucket(INTERVAL '15 min', s.ts),
        s.device, s.phase, s.channel, s.tag, s.domain,
        SUM(s.val::DOUBLE PRECISION),
        COUNT(*),
        MIN(s.val::DOUBLE PRECISION),
        MAX(s.val::DOUBLE PRECISION)
    FROM device_em.stats s
    WHERE s.ts >= p_from AND s.ts < p_to
      AND (p_tags IS NULL OR s.tag = ANY (p_tags))
    GROUP BY 1, s.device, s.phase, s.channel, s.tag, s.domain
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$;

-- undo 20056_em_sync_record_period.sql
-- Keep accepted record periods available for recovery after rollback.
CREATE OR REPLACE FUNCTION device_em.fn_append_stats_synced_batch(
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
    p_sync_channel  INT[]
)
RETURNS BIGINT
LANGUAGE sql
AS
$$
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
        RETURNING device, tag, domain, phase, channel, ts
    ),
    dirty AS (
        INSERT INTO device_em.rollup_dirty
            (bucket, device, tag, domain, phase, channel)
        SELECT DISTINCT
               time_bucket(INTERVAL '15 min', i.ts),
               i.device, i.tag, i.domain, i.phase, i.channel
        FROM ins i
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
    SELECT count(*)::BIGINT
    FROM ins
    CROSS JOIN (SELECT count(*) FROM dirty) ensure_dirty_exec
    CROSS JOIN (SELECT count(*) FROM bm) ensure_bm_exec;
$$;

-- undo 20055_coordinated_stats_retention.sql
-- Preserve recorded expiry even when application code is rolled back.
CREATE OR REPLACE FUNCTION device_em.fn_append_energy_15min(
    p_device  INT[],
    p_tag     VARCHAR(30)[],
    p_domain  VARCHAR(16)[],
    p_phase   VARCHAR(1)[],
    p_channel SMALLINT[],
    p_ts      BIGINT[],
    p_val     REAL[]
)
RETURNS void
LANGUAGE sql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
    WITH affected AS (
        SELECT DISTINCT
            time_bucket(INTERVAL '15 min', to_timestamp(u._ts)) AS bucket,
            u.device, u.tag, u.domain, u.phase, u.channel
        FROM unnest(p_device, p_tag, p_domain, p_phase, p_channel, p_ts)
             AS u(device, tag, domain, phase, channel, _ts)
    ),
    recomputed AS (
        SELECT
            a.bucket, a.device, a.tag, a.domain, a.phase, a.channel,
            SUM(d.val)   AS sum_val,
            COUNT(*)     AS sample_count,
            MIN(d.val)   AS min_val,
            MAX(d.val)   AS max_val
        FROM affected a
        CROSS JOIN LATERAL (
            SELECT bool_or(g.source = 'em_sync') AS has_emsync
            FROM device_em.stats g
            WHERE g.device  = a.device
              AND g.tag     = a.tag
              AND g.domain  = a.domain
              AND g.phase   IS NOT DISTINCT FROM a.phase
              AND g.channel IS NOT DISTINCT FROM a.channel
              AND g.ts >= a.bucket
              AND g.ts <  a.bucket + INTERVAL '15 min'
        ) gate
        CROSS JOIN LATERAL (
            SELECT DISTINCT ON (s.ts) s.val::DOUBLE PRECISION AS val
            FROM device_em.stats s
            WHERE s.device  = a.device
              AND s.tag     = a.tag
              AND s.domain  = a.domain
              AND s.phase   IS NOT DISTINCT FROM a.phase
              AND s.channel IS NOT DISTINCT FROM a.channel
              AND s.ts >= a.bucket
              AND s.ts <  a.bucket + INTERVAL '15 min'
              AND CASE
                      WHEN COALESCE(gate.has_emsync, FALSE)
                          THEN s.source = 'em_sync'
                      ELSE TRUE
                  END
            ORDER BY s.ts
        ) d
        GROUP BY a.bucket, a.device, a.tag, a.domain, a.phase, a.channel
    )
    INSERT INTO device_em.energy_15min
        (bucket, device, phase, channel, tag, domain,
         sum_val, sample_count, min_val, max_val)
    SELECT
        bucket, device, phase, channel, tag, domain,
        sum_val, sample_count, min_val, max_val
    FROM recomputed
    ORDER BY bucket, device, tag, domain, phase, channel
    ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
    SET sum_val      = EXCLUDED.sum_val,
        sample_count = EXCLUDED.sample_count,
        min_val      = EXCLUDED.min_val,
        max_val      = EXCLUDED.max_val;
$$;

-- Coordinated cleanup and expiry evidence must outlive an application rollback.

-- undo 20054_rollup_bounded_work.sql
-- Only unchanged jobs can safely recover their original schedules.
DO $$
DECLARE
    v_saved JSONB;
    v_current JSONB;
BEGIN
    FOR v_saved IN SELECT j FROM device_em.stats_retention_legacy l,
        LATERAL jsonb_array_elements(l.cleanup_jobs) j WHERE l.singleton
    LOOP
        SELECT j INTO v_current FROM jsonb_array_elements(device_em.fn_stats_cleanup_snapshot()) j
        WHERE j->>'job_id'=v_saved->>'job_id';
        IF v_current->>'proc_schema'=v_saved->>'proc_schema'
           AND v_current->>'proc_name'=v_saved->>'proc_name'
           AND v_current->'config'=v_saved->'config' THEN
            PERFORM alter_job((v_saved->>'job_id')::int,
                scheduled => (v_saved->>'scheduled')::boolean);
        END IF;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty(p_limit INT DEFAULT 500)
RETURNS INT
LANGUAGE plpgsql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
DECLARE
    v_done INT;
BEGIN
    WITH claimed AS MATERIALIZED (
        SELECT d.id, d.bucket, d.device, d.tag, d.domain, d.phase, d.channel
        FROM device_em.rollup_dirty d
        ORDER BY d.id
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, p_limit)
    ),
    recomputed AS MATERIALIZED (
        SELECT
            c.bucket, c.device, c.tag, c.domain, c.phase, c.channel,
            SUM(v.val) AS sum_val,
            COUNT(*) AS sample_count,
            MIN(v.val) AS min_val,
            MAX(v.val) AS max_val
        FROM claimed c
        CROSS JOIN LATERAL (
            SELECT bool_or(g.source = 'em_sync') AS has_emsync
            FROM device_em.stats g
            WHERE g.device = c.device
              AND g.tag = c.tag
              AND g.domain = c.domain
              AND g.phase IS NOT DISTINCT FROM c.phase
              AND g.channel IS NOT DISTINCT FROM c.channel
              AND g.ts >= c.bucket
              AND g.ts < c.bucket + INTERVAL '15 min'
        ) gate
        CROSS JOIN LATERAL (
            SELECT DISTINCT ON (s.ts) s.val::DOUBLE PRECISION AS val
            FROM device_em.stats s
            WHERE s.device = c.device
              AND s.tag = c.tag
              AND s.domain = c.domain
              AND s.phase IS NOT DISTINCT FROM c.phase
              AND s.channel IS NOT DISTINCT FROM c.channel
              AND s.ts >= c.bucket
              AND s.ts < c.bucket + INTERVAL '15 min'
              AND CASE
                      WHEN COALESCE(gate.has_emsync, FALSE)
                          THEN s.source = 'em_sync'
                      ELSE TRUE
                  END
            ORDER BY s.ts
        ) v
        GROUP BY c.bucket, c.device, c.tag, c.domain, c.phase, c.channel
    ),
    upserted AS (
        INSERT INTO device_em.energy_15min
            (bucket, device, phase, channel, tag, domain,
             sum_val, sample_count, min_val, max_val)
        SELECT bucket, device, phase, channel, tag, domain,
               sum_val, sample_count, min_val, max_val
        FROM recomputed
        -- Same fixed lock order as fn_append_energy_15min. Ordering one writer
        -- and not the other leaves the cycle intact.
        ORDER BY bucket, device, tag, domain, phase, channel
        ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
        SET sum_val = EXCLUDED.sum_val,
            sample_count = EXCLUDED.sample_count,
            min_val = EXCLUDED.min_val,
            max_val = EXCLUDED.max_val
        RETURNING 1
    ),
    deleted AS (
        DELETE FROM device_em.rollup_dirty d
        USING claimed c
        WHERE d.id = c.id
        RETURNING 1
    )
    SELECT count(*)::INT INTO v_done
    FROM deleted
    CROSS JOIN (SELECT count(*) FROM upserted) ensure_upsert_exec;
    RETURN v_done;
END;
$$;

-- undo 20053_seed_rollups_via_dirty_queue.sql
DROP FUNCTION device_em.fn_mark_energy_15min_dirty(INT[], VARCHAR(30)[], VARCHAR(16)[], VARCHAR(1)[], SMALLINT[], BIGINT[]);
CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty(p_limit INT DEFAULT 500)
RETURNS INT
LANGUAGE plpgsql
SET timescaledb.max_tuples_decompressed_per_dml_transaction TO '0'
AS
$$
DECLARE
    v_done INT;
BEGIN
    WITH claimed AS MATERIALIZED (
        SELECT d.id, d.bucket, d.device, d.tag, d.domain, d.phase, d.channel
        FROM device_em.rollup_dirty d
        ORDER BY d.id
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, p_limit)
    ),
    recomputed AS MATERIALIZED (
        SELECT
            c.bucket, c.device, c.tag, c.domain, c.phase, c.channel,
            SUM(v.val) AS sum_val,
            COUNT(*) AS sample_count,
            MIN(v.val) AS min_val,
            MAX(v.val) AS max_val
        FROM claimed c
        CROSS JOIN LATERAL (
            SELECT bool_or(g.source = 'em_sync') AS has_emsync
            FROM device_em.stats g
            WHERE g.device = c.device
              AND g.tag = c.tag
              AND g.domain = c.domain
              AND g.phase IS NOT DISTINCT FROM c.phase
              AND g.channel IS NOT DISTINCT FROM c.channel
              AND g.ts >= c.bucket
              AND g.ts < c.bucket + INTERVAL '15 min'
        ) gate
        CROSS JOIN LATERAL (
            SELECT DISTINCT ON (s.ts) s.val::DOUBLE PRECISION AS val
            FROM device_em.stats s
            WHERE s.device = c.device
              AND s.tag = c.tag
              AND s.domain = c.domain
              AND s.phase IS NOT DISTINCT FROM c.phase
              AND s.channel IS NOT DISTINCT FROM c.channel
              AND s.ts >= c.bucket
              AND s.ts < c.bucket + INTERVAL '15 min'
              AND CASE
                      WHEN COALESCE(gate.has_emsync, FALSE)
                          THEN s.source = 'em_sync'
                      ELSE TRUE
                  END
            ORDER BY s.ts
        ) v
        GROUP BY c.bucket, c.device, c.tag, c.domain, c.phase, c.channel
    ),
    upserted AS (
        INSERT INTO device_em.energy_15min
            (bucket, device, phase, channel, tag, domain,
             sum_val, sample_count, min_val, max_val)
        SELECT bucket, device, phase, channel, tag, domain,
               sum_val, sample_count, min_val, max_val
        FROM recomputed
        -- Same fixed lock order as fn_append_energy_15min. Ordering one writer
        -- and not the other leaves the cycle intact.
        ORDER BY bucket, device, tag, domain, phase, channel
        ON CONFLICT (bucket, device, tag, domain, phase, channel) DO UPDATE
        SET sum_val = EXCLUDED.sum_val,
            sample_count = EXCLUDED.sample_count,
            min_val = EXCLUDED.min_val,
            max_val = EXCLUDED.max_val
        RETURNING 1
    ),
    deleted AS (
        DELETE FROM device_em.rollup_dirty d
        USING claimed c
        WHERE d.id = c.id
        RETURNING 1
    )
    SELECT count(*)::INT INTO v_done
    FROM deleted
    CROSS JOIN (SELECT count(*) FROM upserted) ensure_upsert_exec;
    RETURN v_done;
END;
$$;
