#!/usr/bin/env bash

set -euo pipefail

_seed_simulator_history_stream() {
    local requested_json="$1" days="$2" from_ts="${3:-}" to_ts="${4:-}"
    local count period_seconds
    local -a profile_args=()
    local -a scenario_args=()
    local -a range_args=(--history-days "$days")
    count=$(jq 'length' <<<"$requested_json")
    period_seconds="${FM_SEED_SIMULATOR_HISTORY_PERIOD_SECONDS:-60}"
    if [ -n "${FM_SEED_SIMULATOR_DEVICE_PROFILES:-}" ]; then
        profile_args=(--profiles "$FM_SEED_SIMULATOR_DEVICE_PROFILES")
    fi
    if [ -n "${FM_SEED_SIMULATOR_SCENARIO:-}" ]; then
        scenario_args=(--scenario "$FM_SEED_SIMULATOR_SCENARIO")
    fi
    if [ -n "$from_ts" ] || [ -n "$to_ts" ]; then
        [ -n "$from_ts" ] && [ -n "$to_ts" ] || {
            error "Simulator history bounds require both from and to timestamps."
            return 1
        }
        range_args=(--history-from-ts "$from_ts" --history-to-ts "$to_ts")
    elif [ -n "${FM_SEED_SIMULATOR_HISTORY_TO_TS:-}" ]; then
        range_args+=(--history-to-ts "$FM_SEED_SIMULATOR_HISTORY_TO_TS")
    fi
    if [ "${ENV_NAME:-}" = "dev" ]; then
        (
            cd "$REPO_ROOT/backend"
            node --import tsx src/devSimulation/main.ts \
                --count "$count" \
                "${profile_args[@]}" \
                "${scenario_args[@]}" \
                --device-ids-json "$requested_json" \
                --print-energy-history \
                "${range_args[@]}" \
                --history-period-seconds "$period_seconds"
        )
        return
    fi

    local app_container
    app_container=$(docker ps \
        --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME:-fm}" \
        --filter 'label=com.docker.compose.service=fleet-manager' \
        --format '{{.Names}}' | head -1)
    if [ -z "$app_container" ]; then
        error "Fleet Manager container not found for simulator history generation."
        return 1
    fi
    docker exec "$app_container" node dist/devSimulation/main.js \
        --count "$count" \
        "${profile_args[@]}" \
        "${scenario_args[@]}" \
        --device-ids-json "$requested_json" \
        --print-energy-history \
        "${range_args[@]}" \
        --history-period-seconds "$period_seconds"
}

validate_simulator_seed_inventory() {
    local requested_json="${1:-${FM_SEED_DEVICE_IDS_JSON:-[]}}"
    jq -e '
        type == "array" and
        all(.[]; type == "string" and length > 0) and
        (length == (unique | length))
    ' <<<"$requested_json" >/dev/null
}

_seed_simulator_history_windows() {
    local history_from="$1" history_to="$2" period_seconds="$3" batch_span="$4"
    local batch_from="$history_from" batch_to
    while [ "$batch_from" -le "$history_to" ]; do
        batch_to=$((batch_from + batch_span - period_seconds))
        [ "$batch_to" -gt "$history_to" ] && batch_to="$history_to"
        printf '%s|%s\n' "$batch_from" "$batch_to"
        batch_from=$((batch_to + period_seconds))
    done
}

_seed_simulator_cleanup_future() {
    local db_container="$1" db_user="$2" db_name="$3" requested_json="$4"
    docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
        -v ON_ERROR_STOP=1 -v "requested_json=$requested_json" >/dev/null <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtext('fleet:simulator-history-seed'));
CREATE TEMP TABLE _requested_simulator_devices (
    external_id VARCHAR(50) PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO _requested_simulator_devices (external_id)
SELECT value FROM jsonb_array_elements_text(:'requested_json'::jsonb);

CREATE TEMP TABLE _invalid_future_history ON COMMIT DROP AS
SELECT stats.*
FROM device_em.stats stats
JOIN device.list device ON device.id = stats.device
JOIN _requested_simulator_devices requested
    ON requested.external_id = device.external_id
WHERE stats.ts > now() + INTERVAL '5 minutes';

SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;
DELETE FROM device_em.stats stats
USING _invalid_future_history invalid
WHERE stats.device = invalid.device
  AND stats.tag = invalid.tag
  AND stats.domain = invalid.domain
  AND stats.phase IS NOT DISTINCT FROM invalid.phase
  AND stats.channel IS NOT DISTINCT FROM invalid.channel
  AND stats.ts = invalid.ts
  AND stats.source IS NOT DISTINCT FROM invalid.source;

SELECT device_em.fn_mark_energy_15min_dirty(
    array_agg(device), array_agg(tag::VARCHAR(30)), array_agg(domain),
    array_agg(phase), array_agg(channel),
    array_agg(extract(epoch FROM ts)::BIGINT)
)
FROM _invalid_future_history
HAVING count(*) > 0;

-- Marking a bucket dirty recomputes it; it never deletes it. A bucket left with
-- no raw rows parks as missing_input instead, because retention drops raw chunks
-- on a schedule and deleting a projection on absent input would erase aged-out
-- history. Seed cleanup is the one caller that does know its data should go, so
-- it removes those projections itself and clears the markers it just made.
WITH emptied AS (
    DELETE FROM device_em.energy_15min saved
    USING (
        SELECT DISTINCT
            time_bucket(INTERVAL '15 min', ts) AS bucket,
            device, tag, domain, phase, channel
        FROM _invalid_future_history
    ) touched
    WHERE saved.bucket = touched.bucket
      AND saved.device = touched.device
      AND saved.tag = touched.tag
      AND saved.domain = touched.domain
      AND saved.phase IS NOT DISTINCT FROM touched.phase
      AND saved.channel IS NOT DISTINCT FROM touched.channel
      AND NOT EXISTS (
          SELECT 1 FROM device_em.stats remaining
          WHERE remaining.device = touched.device
            AND remaining.tag = touched.tag
            AND remaining.domain = touched.domain
            AND remaining.phase IS NOT DISTINCT FROM touched.phase
            AND remaining.channel IS NOT DISTINCT FROM touched.channel
            AND remaining.ts >= touched.bucket
            AND remaining.ts < touched.bucket + INTERVAL '15 min'
      )
    RETURNING saved.bucket, saved.device, saved.tag, saved.domain,
              saved.phase, saved.channel
)
DELETE FROM device_em.rollup_dirty marker
USING emptied
WHERE marker.bucket = emptied.bucket
  AND marker.device = emptied.device
  AND marker.tag = emptied.tag
  AND marker.domain = emptied.domain
  AND marker.phase IS NOT DISTINCT FROM emptied.phase
  AND marker.channel IS NOT DISTINCT FROM emptied.channel;

DELETE FROM device_em.sync sync
USING device.list device, _requested_simulator_devices requested
WHERE sync.device = device.id
  AND requested.external_id = device.external_id
  AND sync.created > extract(epoch FROM now() + INTERVAL '5 minutes')::BIGINT;
COMMIT;
SQL
    _seed_simulator_drain_rollups "$db_container" "$db_user" "$db_name" \
        "$requested_json" "$(( $(date +%s) + 300 ))" 0
}

_seed_simulator_cleanup_window() {
    local db_container="$1" db_user="$2" db_name="$3" requested_json="$4"
    local from_ts="$5" until_ts="$6"
    {
        cat <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtext('fleet:simulator-history-seed'));
CREATE TEMP TABLE _requested_simulator_devices (
    external_id VARCHAR(50) PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO _requested_simulator_devices (external_id)
SELECT value FROM jsonb_array_elements_text(:'requested_json'::jsonb);

CREATE TEMP TABLE _old_simulator_history ON COMMIT DROP AS
SELECT stats.*
FROM device_em.stats stats
JOIN device.list device ON device.id = stats.device
JOIN _requested_simulator_devices requested
    ON requested.external_id = device.external_id
WHERE stats.source = 'demo_seed'
  AND stats.ts >= to_timestamp(:'from_ts'::BIGINT)
  AND stats.ts < to_timestamp(:'until_ts'::BIGINT);

SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;
DELETE FROM device_em.stats stats
USING _old_simulator_history old
WHERE stats.device = old.device
  AND stats.tag = old.tag
  AND stats.domain = old.domain
  AND stats.phase IS NOT DISTINCT FROM old.phase
  AND stats.channel IS NOT DISTINCT FROM old.channel
  AND stats.ts = old.ts
  AND stats.source IS NOT DISTINCT FROM old.source;

CREATE TEMP TABLE _affected_energy_buckets ON COMMIT DROP AS
SELECT DISTINCT time_bucket(INTERVAL '15 min', ts) AS bucket, device, tag, domain, phase, channel
FROM _old_simulator_history;
SQL
        _seed_simulator_rebuild_touched_buckets_sql
        cat <<'SQL'
COMMIT;
SQL
    } | docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
        -v ON_ERROR_STOP=1 -v "requested_json=$requested_json" \
        -v "from_ts=$from_ts" -v "until_ts=$until_ts" >/dev/null || return 1
    _seed_simulator_drain_rollups "$db_container" "$db_user" "$db_name" \
        "$requested_json" "$from_ts" "$until_ts"
}

# SQL that follows a raw delete inside one transaction. Every touched bucket
# lost samples, so its saved summary is wrong. Marking it dirty alone is not
# enough: with no raw rows left the worker parks the key as missing_input, and
# with only synced rows left it refuses to shrink a fuller summary. Seed
# cleanup knows the deleted rows were its own, so it removes the summary,
# rebuilds what still has raw rows here, and forgets what has none. A rebuild
# the worker would park aborts the whole transaction, so nothing is lost
# quietly. Same order as the worker: stats lock, queue rows, summaries.
# Expects _affected_energy_buckets (bucket, device, tag, domain, phase, channel).
_seed_simulator_rebuild_touched_buckets_sql() {
    cat <<'SQL'
LOCK TABLE ONLY device_em.stats IN ROW EXCLUSIVE MODE;
INSERT INTO device_em.rollup_dirty (bucket, device, tag, domain, phase, channel)
SELECT bucket, device, tag, domain, phase, channel FROM _affected_energy_buckets
ORDER BY 1, 2, 3, 4, 5, 6
ON CONFLICT (bucket, device, tag, domain, phase, channel)
DO UPDATE SET last_dirty = now(), blocked_at = NULL, blocked_reason = NULL;

DELETE FROM device_em.energy_15min saved
USING _affected_energy_buckets touched
WHERE saved.bucket = touched.bucket
  AND saved.device = touched.device
  AND saved.tag = touched.tag
  AND saved.domain = touched.domain
  AND saved.phase IS NOT DISTINCT FROM touched.phase
  AND saved.channel IS NOT DISTINCT FROM touched.channel;

DELETE FROM device_em.rollup_dirty marker
USING _affected_energy_buckets touched
WHERE marker.bucket = touched.bucket
  AND marker.device = touched.device
  AND marker.tag = touched.tag
  AND marker.domain = touched.domain
  AND marker.phase IS NOT DISTINCT FROM touched.phase
  AND marker.channel IS NOT DISTINCT FROM touched.channel
  AND NOT EXISTS (
      SELECT 1 FROM device_em.stats remaining
      WHERE remaining.device = touched.device
        AND remaining.tag = touched.tag
        AND remaining.domain = touched.domain
        AND remaining.phase IS NOT DISTINCT FROM touched.phase
        AND remaining.channel IS NOT DISTINCT FROM touched.channel
        AND remaining.ts >= touched.bucket
        AND remaining.ts < touched.bucket + INTERVAL '15 min'
  );

DO $rebuild$
DECLARE
    v_period RECORD;
    v_blocked INT;
BEGIN
    FOR v_period IN
        SELECT marker.bucket, array_agg(marker.id ORDER BY marker.id) AS ids
        FROM device_em.rollup_dirty marker
        JOIN _affected_energy_buckets touched
          ON marker.bucket = touched.bucket
         AND marker.device = touched.device
         AND marker.tag = touched.tag
         AND marker.domain = touched.domain
         AND marker.phase IS NOT DISTINCT FROM touched.phase
         AND marker.channel IS NOT DISTINCT FROM touched.channel
        GROUP BY marker.bucket ORDER BY marker.bucket
    LOOP
        SELECT blocked INTO v_blocked
        FROM device_em.fn_project_rollup_keys(v_period.ids);
        IF v_blocked > 0 THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = 'EM_SEED_CLEANUP_REBUILD_BLOCKED',
                DETAIL = format('bucket %s: %s key(s) parked: %s', v_period.bucket, v_blocked,
                    (SELECT string_agg(DISTINCT blocked_reason, ', ')
                     FROM device_em.rollup_dirty
                     WHERE id = ANY(v_period.ids) AND blocked_at IS NOT NULL));
        END IF;
    END LOOP;
END
$rebuild$;
SQL
}

# Replaying an idempotent window recovers from temporary rollup lock contention.
_seed_simulator_history_batch() {
    local attempt log
    log="$(mktemp)"
    for attempt in 1 2 3; do
        if _seed_simulator_history_batch_once "$@" 2>"$log"; then
            cat "$log" >&2
            rm -f "$log"
            return 0
        fi
        if ! grep -Eq '^ERROR:[[:space:]]+(40P01|55P03):' "$log"; then
            cat "$log" >&2
            rm -f "$log"
            return 1
        fi
        cat "$log" >&2
        [ "$attempt" -lt 3 ] || break
        warn "[energy-seed] Temporary database lock conflict; replaying this window (attempt $((attempt + 1))/3)."
        sleep "$attempt"
    done
    error "[energy-seed] Window still has a database lock conflict after 3 attempts."
    rm -f "$log"
    return 1
}

_seed_simulator_history_batch_once() {
    local db_container="$1" db_user="$2" db_name="$3" requested_json="$4"
    local days="$5" batch_from="$6" batch_to="$7"
    {
        cat <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
-- Windows of one run write disjoint rows, so they share the seed lock. Cleanup
-- takes it exclusively and so waits for every running window.
SELECT pg_advisory_xact_lock_shared(hashtext('fleet:simulator-history-seed'));
CREATE TEMP TABLE _requested_simulator_devices (
    external_id VARCHAR(50) PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO _requested_simulator_devices (external_id)
SELECT value FROM jsonb_array_elements_text(:'requested_json'::jsonb);

CREATE TEMP TABLE _simulated_energy_history (
    external_id VARCHAR(50) NOT NULL,
    ts BIGINT NOT NULL,
    channel SMALLINT NOT NULL,
    phase VARCHAR(1) NOT NULL,
    tag VARCHAR(30) NOT NULL,
    domain VARCHAR(16) NOT NULL,
    val REAL NOT NULL
) ON COMMIT DROP;
COPY _simulated_energy_history
    (external_id, ts, channel, phase, tag, domain, val)
FROM STDIN;
SQL
        _seed_simulator_history_stream "$requested_json" "$days" "$batch_from" "$batch_to"
        printf '\\.\n'
        cat <<'SQL'

CREATE TEMP TABLE _simulator_batch_bounds ON COMMIT DROP AS
SELECT :'batch_from'::BIGINT AS from_ts, :'batch_to'::BIGINT AS to_ts;

DO $seed_validation$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _simulated_energy_history) THEN
        RAISE EXCEPTION 'Simulator history stream is empty';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM _simulated_energy_history history
        CROSS JOIN _simulator_batch_bounds bounds
        WHERE history.ts < bounds.from_ts OR history.ts > bounds.to_ts
    ) THEN
        RAISE EXCEPTION 'Simulator history escaped its requested batch bounds';
    END IF;
    IF EXISTS (
        SELECT 1 FROM _requested_simulator_devices requested
        LEFT JOIN device.list device ON device.external_id = requested.external_id
        WHERE device.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Requested simulator device is missing from device.list';
    END IF;
    IF EXISTS (
        SELECT 1 FROM _simulated_energy_history history
        LEFT JOIN _requested_simulator_devices requested
            ON requested.external_id = history.external_id
        WHERE requested.external_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Simulator history contains a device outside the requested inventory';
    END IF;
END;
$seed_validation$;

CREATE TEMP TABLE _old_simulator_history ON COMMIT DROP AS
SELECT stats.*
FROM device_em.stats stats
JOIN device.list device ON device.id = stats.device
JOIN _requested_simulator_devices requested
    ON requested.external_id = device.external_id
WHERE stats.source = 'demo_seed'
  AND stats.ts >= to_timestamp(:'batch_from'::BIGINT)
  AND stats.ts <= to_timestamp(:'batch_to'::BIGINT);

-- Everything downstream works per 15-minute bucket, so collapse the rows once.
CREATE TEMP TABLE _affected_energy_buckets ON COMMIT DROP AS
SELECT time_bucket(INTERVAL '15 min', ts) AS bucket, device, tag, domain, phase, channel
FROM _old_simulator_history
UNION
SELECT time_bucket(INTERVAL '15 min', to_timestamp(history.ts)), device.id, history.tag,
       history.domain, history.phase, history.channel
FROM _simulated_energy_history history
JOIN device.list device ON device.external_id = history.external_id;

SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;
DELETE FROM device_em.stats stats
USING _old_simulator_history old
WHERE stats.device = old.device
  AND stats.tag = old.tag
  AND stats.domain = old.domain
  AND stats.phase IS NOT DISTINCT FROM old.phase
  AND stats.channel IS NOT DISTINCT FROM old.channel
  AND stats.ts = old.ts
  AND stats.source IS NOT DISTINCT FROM old.source;

INSERT INTO device_em.stats
    (ts, channel, val, phase, device, tag, domain, source)
SELECT to_timestamp(history.ts), history.channel, history.val, history.phase,
       device.id, history.tag, history.domain, 'demo_seed'
FROM _simulated_energy_history history
JOIN device.list device ON device.external_id = history.external_id
ON CONFLICT DO NOTHING;

-- Every touched bucket is rebuilt from raw in this transaction; buckets left
-- without raw rows are forgotten, see _seed_simulator_rebuild_touched_buckets_sql.
SQL
        _seed_simulator_rebuild_touched_buckets_sql
        cat <<'SQL'
COMMIT;
SQL
    } | docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
        -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -v "requested_json=$requested_json" \
        -v "batch_from=$batch_from" -v "batch_to=$batch_to" >/dev/null
}

_seed_simulator_drain_rollups() {
    local db_container="$1" db_user="$2" db_name="$3" requested_json="$4"
    local from_ts="$5" to_ts="$6" pending parked deadline=$((SECONDS + 300))
    while [ "$SECONDS" -lt "$deadline" ]; do
        # A parked row is never claimed again, so waiting on it only burns the
        # deadline. Report it now, with its reason, and count only open rows.
        pending=$(docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
            -AtX -F '|' -v ON_ERROR_STOP=1 -v "requested_json=$requested_json" \
            -v "from_ts=$from_ts" -v "to_ts=$to_ts" <<'SQL'
SELECT count(*) FILTER (WHERE dirty.blocked_at IS NULL),
       coalesce(string_agg(DISTINCT dirty.blocked_reason, ',') FILTER (WHERE dirty.blocked_at IS NOT NULL), '')
FROM device_em.rollup_dirty dirty
JOIN device.list device ON device.id = dirty.device
WHERE device.external_id IN (
    SELECT value FROM jsonb_array_elements_text(:'requested_json'::jsonb)
)
AND (:'from_ts'::BIGINT = 0 OR dirty.bucket >= time_bucket(INTERVAL '15 min', to_timestamp(:'from_ts'::BIGINT)))
AND (:'to_ts'::BIGINT = 0 OR dirty.bucket <= time_bucket(INTERVAL '15 min', to_timestamp(:'to_ts'::BIGINT)));
SQL
        ) || return 1
        parked="${pending#*|}"
        pending="${pending%%|*}"
        if [ -n "$parked" ]; then
            error "Simulator history rollup queue has parked rows (${parked}); they will never drain."
            return 1
        fi
        [ "$pending" = 0 ] && return 0
        # The canonical worker owns both replacement and empty-bucket removal.
        docker exec "$db_container" psql -U "$db_user" -d "$db_name" \
            -X -v ON_ERROR_STOP=1 -c "SET statement_timeout = '30s'; SELECT device_em.fn_rollup_dirty(500);" \
            >/dev/null || return 1
        sleep 1
    done
    error "Simulator history rollup queue did not drain within 300 seconds."
    return 1
}

# Seeds the windows from from_ts to to_ts, up to `parallel` at once. Windows share
# no rows, and a bucket split across two windows is serialized by its queue row, so
# running them together writes the same data. A failure starts no new window.
# "prefix" keeps the windows before the first failure, which is exactly where the
# next run's tail top-up resumes. "all" removes every window this call committed,
# because the head backfill can only resume from its own start.
_seed_simulator_history_run_windows() {
    local db_container="$1" db_user="$2" db_name="$3" requested_json="$4"
    local days="$5" from_ts="$6" to_ts="$7" period_seconds="$8" batch_span="$9"
    local on_failure="${10}" parallel="${11}"
    local -a starts=() ends=() pids=() states=()
    local logs start end next=0 oldest=0 failed_index=-1 i
    logs="$(mktemp -d)"
    while IFS='|' read -r start end; do
        starts+=("$start")
        ends+=("$end")
    done < <(_seed_simulator_history_windows \
        "$from_ts" "$to_ts" "$period_seconds" "$batch_span")

    while [ "$oldest" -lt "$next" ] || \
        { [ "$failed_index" -lt 0 ] && [ "$next" -lt "${#starts[@]}" ]; }; do
        if [ "$failed_index" -lt 0 ] && [ "$next" -lt "${#starts[@]}" ] \
            && [ $((next - oldest)) -lt "$parallel" ]; then
            _seed_simulator_history_batch "$db_container" "$db_user" "$db_name" \
                "$requested_json" "$days" "${starts[next]}" "${ends[next]}" \
                >"$logs/$next.log" 2>&1 &
            pids[next]=$!
            next=$((next + 1))
            continue
        fi
        if wait "${pids[oldest]}"; then
            states[oldest]=ok
            cat "$logs/$oldest.log"
            info "[energy-seed] Committed history window ${starts[oldest]}..${ends[oldest]}."
        else
            states[oldest]=failed
            [ "$failed_index" -ge 0 ] || failed_index="$oldest"
            cat "$logs/$oldest.log" >&2
            error "[energy-seed] History window ${starts[oldest]}..${ends[oldest]} failed."
        fi
        oldest=$((oldest + 1))
    done

    if [ "$failed_index" -lt 0 ]; then
        rm -rf "$logs"
        return 0
    fi
    i=$((failed_index + 1))
    [ "$on_failure" != all ] || i=0
    while [ "$i" -lt "$next" ]; do
        if [ "${states[i]}" = ok ]; then
            warn "[energy-seed] Removing window ${starts[i]}..${ends[i]} so no gap is left behind the failure."
            if ! _seed_simulator_cleanup_window "$db_container" "$db_user" "$db_name" \
                "$requested_json" "${starts[i]}" "$((ends[i] + period_seconds))"; then
                error "[energy-seed] Could not remove window ${starts[i]}..${ends[i]}; rerun with FM_SEED_SIMULATOR_HISTORY_FULL=true."
            fi
        fi
        i=$((i + 1))
    done
    rm -rf "$logs"
    return 1
}

seed_simulator_energy_history() {
    local requested_json="${FM_SEED_DEVICE_IDS_JSON:-[]}" count days
    if ! validate_simulator_seed_inventory "$requested_json"; then
        error "Simulator inventory must be an array of unique, non-empty device IDs."
        return 1
    fi
    count=$(jq 'length' <<<"$requested_json")
    if [ "$count" -eq 0 ]; then
        error "Simulator history requires a non-empty device inventory."
        return 1
    fi
    days="${FM_SEED_SIMULATOR_HISTORY_DAYS:-60}"

    # A shared-database deployment puts the app and the database in different
    # compose projects, so the project name cannot name both containers.
    local db_container="${1:-${FM_SEED_DB_CONTAINER:-${COMPOSE_PROJECT_NAME:-fm}-fleet-db-1}}"
    local db_user="${POSTGRES_USER:-postgres}"
    local db_name="${POSTGRES_DB:-fleet}"
    if ! docker ps --filter "name=^${db_container}$" --format '{{.Names}}' \
        | grep -qx "$db_container"; then
        error "Simulator history database container is not running: $db_container"
        return 1
    fi

    local period_seconds="${FM_SEED_SIMULATOR_HISTORY_PERIOD_SECONDS:-60}"
    local batch_days="${FM_SEED_SIMULATOR_HISTORY_BATCH_DAYS:-1}"
    local parallel="${FM_SEED_SIMULATOR_HISTORY_PARALLEL:-3}"
    local history_to history_from batch_span batch_from batch_to old_bounds old_min old_max
    local covered_from covered_to head_to
    [[ "$days" =~ ^[1-9][0-9]*$ ]] || { error "Simulator history days must be positive."; return 1; }
    [[ "$period_seconds" =~ ^[1-9][0-9]*$ ]] || { error "Simulator history period must be positive."; return 1; }
    [[ "$batch_days" =~ ^[1-9][0-9]*$ ]] || { error "Simulator history batch days must be positive."; return 1; }
    [[ "$parallel" =~ ^[1-9][0-9]*$ ]] || { error "Simulator history parallel windows must be positive."; return 1; }

    history_to="${FM_SEED_SIMULATOR_HISTORY_TO_TS:-}"
    if [ -z "$history_to" ]; then
        history_to=$(( $(date +%s) / period_seconds * period_seconds - period_seconds ))
    fi
    [[ "$history_to" =~ ^[1-9][0-9]*$ ]] || { error "Simulator history end must be positive."; return 1; }
    history_from=$((history_to - days * 24 * 60 * 60))
    batch_span=$((batch_days * 24 * 60 * 60 / period_seconds * period_seconds))
    [ "$batch_span" -ge "$period_seconds" ] || {
        error "Simulator history batch window is shorter than one sample period."
        return 1
    }

    info "[energy-seed] Backfilling meter history for ${count} simulator devices × ${days} days in bounded daily batches..."
    _seed_simulator_cleanup_future "$db_container" "$db_user" "$db_name" "$requested_json"

    old_bounds=$(docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
        -AtX -F '|' -v ON_ERROR_STOP=1 -v "requested_json=$requested_json" <<'SQL'
WITH requested AS (
    SELECT value AS external_id
    FROM jsonb_array_elements_text(:'requested_json'::jsonb)
), per_device AS (
    SELECT stats.device, min(stats.ts) AS first_ts, max(stats.ts) AS last_ts
    FROM device_em.stats stats
    JOIN device.list device ON device.id = stats.device
    JOIN requested ON requested.external_id = device.external_id
    WHERE stats.source = 'demo_seed'
    GROUP BY stats.device
)
SELECT COALESCE(extract(epoch FROM min(first_ts))::BIGINT::TEXT, ''),
       COALESCE(extract(epoch FROM max(last_ts))::BIGINT::TEXT, ''),
       COALESCE(extract(epoch FROM min(last_ts))::BIGINT::TEXT, ''),
       COALESCE(extract(epoch FROM max(first_ts))::BIGINT::TEXT, '')
FROM per_device;
SQL
    )
    # covered_from is the LATEST per-device start, just as covered_to is the
    # earliest per-device end. Together they describe the interval every
    # seeded energy meter actually covers.
    # covered_to is the EARLIEST per-device end, so a top-up regenerates from the
    # point every device is still covered — one lagging device can't be skipped
    # by a fleet-wide MAX.
    IFS='|' read -r old_min old_max covered_to covered_from <<<"$old_bounds"

    if [ -n "$old_min" ] && [ "$old_min" -lt "$history_from" ]; then
        batch_from="$old_min"
        while [ "$batch_from" -lt "$history_from" ]; do
            batch_to=$((batch_from + batch_span))
            [ "$batch_to" -gt "$history_from" ] && batch_to="$history_from"
            _seed_simulator_cleanup_window "$db_container" "$db_user" "$db_name" \
                "$requested_json" "$batch_from" "$batch_to"
            batch_from="$batch_to"
        done
    fi
    if [ -n "$old_max" ] && [ "$old_max" -gt "$history_to" ]; then
        batch_from=$((history_to + period_seconds))
        while [ "$batch_from" -le "$old_max" ]; do
            batch_to=$((batch_from + batch_span))
            [ "$batch_to" -gt $((old_max + period_seconds)) ] && batch_to=$((old_max + period_seconds))
            _seed_simulator_cleanup_window "$db_container" "$db_user" "$db_name" \
                "$requested_json" "$batch_from" "$batch_to"
            batch_from="$batch_to"
        done
    fi

    # An earlier partial seed can have a current tail but still begin after
    # the requested retention boundary. Fill that missing head before the
    # normal tail top-up; otherwise billing-period completeness remains false
    # forever even though every subsequent seed reports the latest data.
    if [ -n "$covered_from" ] && [ "$covered_from" -gt "$history_from" ]; then
        head_to=$((covered_from - period_seconds))
        info "[energy-seed] Complete fleet history begins at ${covered_from}; backfilling missing head ${history_from}..${head_to}."
        _seed_simulator_history_run_windows "$db_container" "$db_user" "$db_name" \
            "$requested_json" "$days" "$history_from" "$head_to" \
            "$period_seconds" "$batch_span" all "$parallel" || return 1
    fi

    # Demo history is only as fresh as the last seed run. Everything after that
    # end depends on live device sync, which covers a subset of the fleet, so a
    # re-run must extend the tail — otherwise recent-window dashboards read ~0
    # for whichever stores the live path did not keep current.
    local generate_from="$history_from"
    if [ "${FM_SEED_SIMULATOR_HISTORY_FULL:-false}" != "true" ] \
        && [ -n "$covered_to" ] && [ "$covered_to" -ge "$history_from" ]; then
        # Readings sit on a grid that starts at history_from, so resume on that grid;
        # rounding to whole periods would shift every reading of a non-aligned end.
        generate_from=$((history_from + ((covered_to - history_from) / period_seconds + 1) * period_seconds))
        if [ "$generate_from" -gt "$history_to" ]; then
            ok "[energy-seed] Meter history already current — nothing to top up."
            return 0
        fi
        info "[energy-seed] History covers through ${covered_to}; topping up ${generate_from}..${history_to} only."
    fi

    _seed_simulator_history_run_windows "$db_container" "$db_user" "$db_name" \
        "$requested_json" "$days" "$generate_from" "$history_to" \
        "$period_seconds" "$batch_span" prefix "$parallel" || return 1
    ok "[energy-seed] Simulator meter history seeded."
}
