#!/usr/bin/env bash
# Seeded environmental history for the simulated fleet.
#
# The energy loader backfills meters. Nothing backfilled the sensors, so a
# freshly seeded cabinet had a temperature reading from the moment the simulator
# started and nothing before it: every trend, compliance chart and learned
# baseline had one point to work with. The rows come from the simulator's own
# sensor model, the same one the running device follows, so the seeded past and
# the live present describe one probe.
#
# Rows land in device_sensor.numeric_15min through
# device_sensor.fn_append_numeric_15min — the function sensorCapture.ts calls at
# runtime — so a seeded bucket and a captured bucket are the same row to every
# reader. The function buckets and aggregates by itself, so a sample period
# shorter than 15 minutes needs no aggregation here.
#
# Batching, bounds and the database container follow
# seed-simulator-energy-history.sh, and this file reuses its window and
# inventory helpers rather than keeping a second copy of the same arithmetic.

set -euo pipefail

# TSV: external_id, ts, component, tag, value. Dev runs the TypeScript directly,
# like the energy loader; anything else runs the built file in the app container.
_seed_sensor_history_stream() {
    local requested_json="$1" from_ts="$2" to_ts="$3"
    local count period_seconds
    local -a profile_args=()
    local -a scenario_args=()
    count=$(jq 'length' <<<"$requested_json")
    period_seconds="${FM_SEED_SIMULATOR_HISTORY_PERIOD_SECONDS:-60}"
    if [ -n "${FM_SEED_SIMULATOR_DEVICE_PROFILES:-}" ]; then
        profile_args=(--profiles "$FM_SEED_SIMULATOR_DEVICE_PROFILES")
    fi
    if [ -n "${FM_SEED_SIMULATOR_SCENARIO:-}" ]; then
        scenario_args=(--scenario "$FM_SEED_SIMULATOR_SCENARIO")
    fi

    if [ "${ENV_NAME:-}" = "dev" ]; then
        (
            cd "$REPO_ROOT/backend"
            node --import tsx src/devSimulation/main.ts \
                --count "$count" \
                "${profile_args[@]}" \
                "${scenario_args[@]}" \
                --device-ids-json "$requested_json" \
                --print-sensor-history \
                --history-from-ts "$from_ts" \
                --history-to-ts "$to_ts" \
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
        error "Fleet Manager container not found for simulator sensor history generation."
        return 1
    fi
    docker exec "$app_container" node dist/devSimulation/main.js \
        --count "$count" \
        "${profile_args[@]}" \
        "${scenario_args[@]}" \
        --device-ids-json "$requested_json" \
        --print-sensor-history \
        --history-from-ts "$from_ts" \
        --history-to-ts "$to_ts" \
        --history-period-seconds "$period_seconds"
}

# Loads one already-generated batch file. Prints the number of readings loaded.
_seed_simulator_sensor_history_batch() {
    local db_container="$1" db_user="$2" db_name="$3" inventory_json="$4"
    local batch_from="$5" batch_to="$6" tsv="$7"
    {
        cat <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtext('fleet:simulator-sensor-history-seed'));
CREATE TEMP TABLE _requested_sensor_devices (
    external_id VARCHAR(50) PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO _requested_sensor_devices (external_id)
SELECT value FROM jsonb_array_elements_text(:'inventory_json'::jsonb);

CREATE TEMP TABLE _simulated_sensor_history (
    external_id VARCHAR(50) NOT NULL,
    ts BIGINT NOT NULL,
    component VARCHAR(40) NOT NULL,
    tag VARCHAR(24) NOT NULL,
    val REAL NOT NULL
) ON COMMIT DROP;
COPY _simulated_sensor_history (external_id, ts, component, tag, val)
FROM STDIN;
SQL
        cat "$tsv"
        printf '\\.\n'
        cat <<'SQL'

CREATE TEMP TABLE _sensor_batch_bounds ON COMMIT DROP AS
SELECT :'batch_from'::BIGINT AS from_ts, :'batch_to'::BIGINT AS to_ts;

DO $seed_validation$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM _simulated_sensor_history history
        CROSS JOIN _sensor_batch_bounds bounds
        WHERE history.ts < bounds.from_ts OR history.ts > bounds.to_ts
    ) THEN
        RAISE EXCEPTION 'Simulator sensor history escaped its requested batch bounds';
    END IF;
    IF EXISTS (
        SELECT 1 FROM _simulated_sensor_history history
        LEFT JOIN _requested_sensor_devices requested
            ON requested.external_id = history.external_id
        WHERE requested.external_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Simulator sensor history contains a device outside the requested inventory';
    END IF;
    IF EXISTS (
        SELECT 1 FROM _simulated_sensor_history history
        WHERE history.component !~ '^[a-z_]+:[0-9]+$'
    ) THEN
        RAISE EXCEPTION 'Simulator sensor history carries a component that is not <type>:<id>';
    END IF;
    IF EXISTS (
        SELECT 1 FROM _simulated_sensor_history history
        LEFT JOIN device.list device ON device.external_id = history.external_id
        WHERE device.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Simulator sensor history names a device missing from device.list';
    END IF;
END;
$seed_validation$;

-- The reading source is the vocabulary sensorCapture.ts writes and Sensor.Query
-- filters on. A reading filed under a blu_* identity was taken by a paired BLU
-- sensor whatever component relayed it; for a device's own sensors it is the
-- same rule ShellyMessageHandler applies live, add-on probes sitting at 100 and
-- above and everything below that being built in.
CREATE TEMP TABLE _sensor_rows ON COMMIT DROP AS
SELECT device.id AS device,
       (CASE
            WHEN left(history.external_id, 4) = 'blu_' THEN 'blu'
            WHEN split_part(history.component, ':', 2)::INTEGER >= 100 THEN 'addon'
            ELSE 'builtin'
        END)::VARCHAR(12) AS source,
       history.tag::VARCHAR(24) AS kind,
       split_part(history.component, ':', 2)::SMALLINT AS channel,
       history.ts,
       history.val
FROM _simulated_sensor_history history
JOIN device.list device ON device.external_id = history.external_id;

-- Re-seeding replaces this generator's own window rather than accumulating a
-- second copy into the same buckets: fn_append_numeric_15min adds sum_val and
-- sample_count together, so an un-cleaned rerun keeps the average and doubles
-- the sample count. Channel is deliberately not part of the key, so a series
-- that moved to another component id leaves nothing behind in the window.
CREATE TEMP TABLE _sensor_owned_series ON COMMIT DROP AS
SELECT DISTINCT device, source, kind FROM _sensor_rows;

SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0;
DELETE FROM device_sensor.numeric_15min existing
USING _sensor_owned_series owned, _sensor_batch_bounds bounds
WHERE existing.device = owned.device
  AND existing.source = owned.source
  AND existing.kind = owned.kind
  AND existing.bucket >= time_bucket(INTERVAL '15 min', to_timestamp(bounds.from_ts))
  AND existing.bucket <= time_bucket(INTERVAL '15 min', to_timestamp(bounds.to_ts));

SELECT device_sensor.fn_append_numeric_15min(
    array_agg(device ORDER BY ts, device, kind, channel)::INT[],
    array_agg(source ORDER BY ts, device, kind, channel)::VARCHAR(12)[],
    array_agg(kind ORDER BY ts, device, kind, channel)::VARCHAR(24)[],
    array_agg(channel ORDER BY ts, device, kind, channel)::SMALLINT[],
    array_agg(ts ORDER BY ts, device, kind, channel)::BIGINT[],
    array_agg(val ORDER BY ts, device, kind, channel)::REAL[]
)
FROM _sensor_rows
HAVING count(*) > 0;
COMMIT;
SQL
    } | docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
        -v ON_ERROR_STOP=1 -v "inventory_json=$inventory_json" \
        -v "batch_from=$batch_from" -v "batch_to=$batch_to" >/dev/null
}

seed_simulator_sensor_history() {
    local requested_json="${FM_SEED_DEVICE_IDS_JSON:-[]}"
    local blu_json="${FM_SEED_BLU_DEVICE_IDS_JSON:-[]}"
    local inventory_json count days
    if ! validate_simulator_seed_inventory "$requested_json" \
        || ! validate_simulator_seed_inventory "$blu_json"; then
        error "Simulator inventory must be an array of unique, non-empty device IDs."
        return 1
    fi
    count=$(jq 'length' <<<"$requested_json")
    [ "$count" -gt 0 ] || return 0
    # A BLU child broadcasts through its gateway but is its own device row, so
    # both inventories are what the stream is allowed to name.
    inventory_json=$(jq -cn --argjson gateways "$requested_json" \
        --argjson blu "$blu_json" '$gateways + $blu | unique')
    days="${FM_SEED_SIMULATOR_HISTORY_DAYS:-60}"

    # Same split-project reason as the energy history: the app and the database
    # can live in different compose projects.
    local db_container="${1:-${FM_SEED_DB_CONTAINER:-${COMPOSE_PROJECT_NAME:-fm}-fleet-db-1}}"
    local db_user="${POSTGRES_USER:-postgres}"
    local db_name="${POSTGRES_DB:-fleet}"
    if ! docker ps --filter "name=^${db_container}$" --format '{{.Names}}' \
        | grep -qx "$db_container"; then
        error "Sensor history database container is not running: $db_container"
        return 1
    fi

    local period_seconds="${FM_SEED_SIMULATOR_HISTORY_PERIOD_SECONDS:-60}"
    local batch_days="${FM_SEED_SIMULATOR_HISTORY_BATCH_DAYS:-1}"
    local history_to history_from batch_span batch_from batch_to
    [[ "$days" =~ ^[1-9][0-9]*$ ]] || { error "Sensor history days must be positive."; return 1; }
    [[ "$period_seconds" =~ ^[1-9][0-9]*$ ]] || { error "Sensor history period must be positive."; return 1; }
    [[ "$batch_days" =~ ^[1-9][0-9]*$ ]] || { error "Sensor history batch days must be positive."; return 1; }

    history_to="${FM_SEED_SIMULATOR_HISTORY_TO_TS:-}"
    if [ -z "$history_to" ]; then
        history_to=$(( $(date +%s) / period_seconds * period_seconds - period_seconds ))
    fi
    [[ "$history_to" =~ ^[1-9][0-9]*$ ]] || { error "Sensor history end must be positive."; return 1; }
    history_from=$((history_to - days * 24 * 60 * 60))
    batch_span=$((batch_days * 24 * 60 * 60 / period_seconds * period_seconds))
    [ "$batch_span" -ge "$period_seconds" ] || {
        error "Sensor history batch window is shorter than one sample period."
        return 1
    }

    local tsv errors rows loaded=0
    tsv=$(mktemp)
    errors=$(mktemp)
    trap 'rm -f "${tsv:-}" "${errors:-}"' RETURN

    info "[sensor-seed] Backfilling environmental history for ${count} simulator gateways × ${days} days in bounded daily batches..."
    while IFS='|' read -r batch_from batch_to; do
        if ! _seed_sensor_history_stream "$requested_json" \
            "$batch_from" "$batch_to" >"$tsv" 2>"$errors"; then
            error "Simulator sensor history generation failed for ${batch_from}..${batch_to}: $(tr '\n' ' ' <"$errors")"
            return 1
        fi
        rows=$(grep -c . <"$tsv" || true)
        [ "$rows" -gt 0 ] || continue
        _seed_simulator_sensor_history_batch "$db_container" "$db_user" \
            "$db_name" "$inventory_json" "$batch_from" "$batch_to" "$tsv"
        loaded=$((loaded + rows))
        info "[sensor-seed] Committed ${rows} reading(s) for window ${batch_from}..${batch_to}."
    done < <(_seed_simulator_history_windows \
        "$history_from" "$history_to" "$period_seconds" "$batch_span")

    if [ "$loaded" -eq 0 ]; then
        info "[sensor-seed] No environmental sensors in the fleet — no sensor history."
        return 0
    fi
    ok "[sensor-seed] ${loaded} sensor reading(s) seeded across ${days} days."
}
