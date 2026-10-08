-- A rollup claim must skip rows another writer holds, not wait on them.
-- fn_append_energy_15min marks its buckets through INSERT ... ON CONFLICT DO
-- UPDATE, which takes rollup_dirty rows in natural-key order. This function
-- took the same rows by id and waited, so a bulk append and the rollup worker
-- could each hold what the other needed. PostgreSQL then killed one of them.
-- Skipping makes this side never wait, which removes the cycle. Nothing is
-- lost: a skipped row keeps its dirty marker and is claimed on a later pass.

--------------UP

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
    v_ids BIGINT[];
BEGIN
    LOCK TABLE ONLY device_em.stats IN ROW EXCLUSIVE MODE;
    -- A queue claim skips what another writer holds instead of waiting for it.
    -- fn_append_energy_15min takes these same rows in natural-key order through
    -- ON CONFLICT while this claim takes them by id, so a blocking claim closed
    -- a deadlock cycle. A skipped row stays dirty and is claimed on a later pass.
    SELECT array_agg(locked.id ORDER BY locked.id) INTO v_ids FROM (
        SELECT d.id FROM device_em.rollup_dirty d
        WHERE d.id = ANY(p_ids) ORDER BY d.id FOR UPDATE SKIP LOCKED
    ) locked;
    IF v_ids IS NULL THEN RETURN QUERY SELECT 0, 0; RETURN; END IF;
    SELECT min(bucket), max(bucket) INTO v_from, v_to
    FROM device_em.rollup_dirty WHERE id = ANY(v_ids);
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
    $project$ USING v_ids, v_from, v_to, v_expiry, p_missing_only, v_source_available_from;
END;
$$;

--------------DOWN

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
