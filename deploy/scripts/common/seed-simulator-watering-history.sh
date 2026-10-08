#!/usr/bin/env bash
# Seeded watering history for the simulated irrigation controllers.
#
# The Water page decides "ran" or "did not run" from valve events. A freshly
# seeded fleet has none, so every zone reads "did not run" until the next
# morning run — on controllers that have been watering correctly all along.
#
# The rows come from the simulator's own run model
# (backend/src/devSimulation/wateringHistory.ts), the same one the live device
# follows, so the seeded past and the running present describe one schedule.

set -euo pipefail

# Print the zone runs for the window. Dev runs the TypeScript directly, like the
# energy history seeder; anything else runs the built file in the app container.
_seed_watering_stream() {
    local requested_json="$1" count="$2" from_ts="$3" to_ts="$4"
    local -a profile_args=()
    if [ -n "${FM_SEED_SIMULATOR_DEVICE_PROFILES:-}" ]; then
        profile_args=(--profiles "$FM_SEED_SIMULATOR_DEVICE_PROFILES")
    fi

    if [ "${ENV_NAME:-}" = "dev" ]; then
        (
            cd "$REPO_ROOT/backend"
            node --import tsx src/devSimulation/main.ts \
                --count "$count" \
                "${profile_args[@]}" \
                --device-ids-json "$requested_json" \
                --print-watering-history \
                --history-from-ts "$from_ts" \
                --history-to-ts "$to_ts"
        )
        return
    fi

    local app_container
    app_container=$(docker ps \
        --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME:-fm}" \
        --filter 'label=com.docker.compose.service=fleet-manager' \
        --format '{{.Names}}' | head -1)
    if [ -z "$app_container" ]; then
        error "Fleet Manager container not found for watering history generation."
        return 1
    fi
    docker exec "$app_container" node dist/devSimulation/main.js \
        --count "$count" \
        "${profile_args[@]}" \
        --device-ids-json "$requested_json" \
        --print-watering-history \
        --history-from-ts "$from_ts" \
        --history-to-ts "$to_ts"
}

seed_simulator_watering_history() {
    local requested_json="${FM_SEED_DEVICE_IDS_JSON:-[]}" count days
    count=$(jq 'length' <<<"$requested_json")
    [ "$count" -gt 0 ] || return 0
    days="${FM_SEED_SIMULATOR_HISTORY_DAYS:-60}"

    # Same split-project reason as the energy history above.
    local db_container="${1:-${FM_SEED_DB_CONTAINER:-${COMPOSE_PROJECT_NAME:-fm}-fleet-db-1}}"
    local db_user="${POSTGRES_USER:-postgres}"
    local db_name="${POSTGRES_DB:-fleet}"
    if ! docker ps --filter "name=^${db_container}$" --format '{{.Names}}' \
        | grep -qx "$db_container"; then
        error "Watering history database container is not running: $db_container"
        return 1
    fi

    local to_ts from_ts rows
    # Empty until mktemp runs, so the RETURN trap below has something to read
    # if this function leaves early under set -u.
    local tsv=''
    to_ts=$(date +%s)
    from_ts=$((to_ts - days * 24 * 60 * 60))

    # Generated once into a file: the rows are wanted twice, to count them and
    # to load them, and running the model twice invites two different answers.
    tsv=$(mktemp)
    trap 'rm -f "${tsv:-}"' RETURN
    _seed_watering_stream "$requested_json" "$count" "$from_ts" "$to_ts" \
        2>/dev/null >"$tsv"
    rows=$(wc -l <"$tsv" | tr -d ' ')
    if [ "$rows" -eq 0 ]; then
        info "  no irrigation controllers in the fleet — no watering history."
        return 0
    fi

    {
        cat <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE _seeded_waterings (
    external_id VARCHAR(50) NOT NULL,
    ts BIGINT NOT NULL,
    kind VARCHAR(24) NOT NULL,
    channel SMALLINT NOT NULL,
    state SMALLINT NOT NULL
) ON COMMIT DROP;
COPY _seeded_waterings (external_id, ts, kind, channel, state) FROM STDIN;
SQL
        _seed_watering_stream "$requested_json" "$count" "$from_ts" "$to_ts" 2>/dev/null
        printf '\\.\n'
        cat <<'SQL'

-- Re-seeding replaces the demo window rather than stacking a second copy of
-- the same runs. Only demo_seed rows are touched; a live capture is never
-- deleted.
DELETE FROM device_sensor.events e
USING device.list d, _seeded_waterings w
WHERE e.device = d.id
  AND d.external_id = w.external_id
  AND e.source = 'demo_seed'
  AND e.kind = 'valve'
  AND e.ts >= to_timestamp((SELECT min(ts) FROM _seeded_waterings))
  AND e.ts <= to_timestamp((SELECT max(ts) FROM _seeded_waterings));

SELECT device_sensor.fn_append_events(
    array_agg(d.id)::INT[],
    array_agg('demo_seed'::VARCHAR(12))::VARCHAR(12)[],
    array_agg(w.kind)::VARCHAR(24)[],
    array_agg(w.channel)::SMALLINT[],
    array_agg(w.ts)::BIGINT[],
    array_agg(w.state)::SMALLINT[]
)
FROM _seeded_waterings w
JOIN device.list d ON d.external_id = w.external_id;
COMMIT;
SQL
    } | docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
        -v ON_ERROR_STOP=1 -q

    info "  $rows watering event(s) seeded across ${days} days."
}
