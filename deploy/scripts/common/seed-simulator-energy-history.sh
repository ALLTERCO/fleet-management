#!/usr/bin/env bash

set -euo pipefail

_seed_simulator_history_stream() {
    local requested_json="$1" days="$2" count
    count=$(jq 'length' <<<"$requested_json")
    if [ "${ENV_NAME:-}" = "dev" ]; then
        (
            cd "$REPO_ROOT/backend"
            node --import tsx src/devSimulation/main.ts \
                --count "$count" \
                --device-ids-json "$requested_json" \
                --print-energy-history \
                --history-days "$days"
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
        --device-ids-json "$requested_json" \
        --print-energy-history \
        --history-days "$days"
}

validate_simulator_seed_inventory() {
    local requested_json="${1:-${FM_SEED_DEVICE_IDS_JSON:-[]}}"
    jq -e '
        type == "array" and
        all(.[]; type == "string" and length > 0) and
        (length == (unique | length))
    ' <<<"$requested_json" >/dev/null
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
    days="${FM_SEED_SIMULATOR_HISTORY_DAYS:-7}"

    local db_container="${1:-${COMPOSE_PROJECT_NAME:-fm}-fleet-db-1}"
    local db_user="${POSTGRES_USER:-postgres}"
    local db_name="${POSTGRES_DB:-fleet}"
    if ! docker ps --filter "name=^${db_container}$" --format '{{.Names}}' \
        | grep -qx "$db_container"; then
        error "Simulator history database container is not running: $db_container"
        return 1
    fi

    info "[energy-seed] Backfilling meter history for ${count} simulator devices × ${days} days..."
    {
        cat <<'SQL'
BEGIN;
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
        _seed_simulator_history_stream "$requested_json" "$days"
        printf '\\.\n'
        cat <<'SQL'

DO $seed_validation$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM _simulated_energy_history) THEN
        RAISE EXCEPTION 'Simulator history stream is empty';
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
    IF EXISTS (
        SELECT 1 FROM _simulated_energy_history history
        LEFT JOIN device.list device ON device.external_id = history.external_id
        WHERE device.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Simulator history contains a device missing from device.list';
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
   OR stats.ts > now() + INTERVAL '5 minutes';

CREATE TEMP TABLE _affected_energy_keys ON COMMIT DROP AS
SELECT ts, device, tag, domain, phase, channel
FROM _old_simulator_history
UNION
SELECT
    to_timestamp(history.ts),
    device.id,
    history.tag,
    history.domain,
    history.phase,
    history.channel
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

DELETE FROM device_em.sync sync
USING device.list device, _requested_simulator_devices requested
WHERE sync.device = device.id
  AND requested.external_id = device.external_id
  AND sync.created > extract(epoch FROM now() + INTERVAL '5 minutes')::BIGINT;

INSERT INTO device_em.stats
    (ts, channel, val, phase, device, tag, domain, source)
SELECT
    to_timestamp(history.ts),
    history.channel,
    history.val,
    history.phase,
    device.id,
    history.tag,
    history.domain,
    'demo_seed'
FROM _simulated_energy_history history
JOIN device.list device ON device.external_id = history.external_id
ON CONFLICT DO NOTHING;

DELETE FROM device_em.energy_15min rollup
USING (
    SELECT DISTINCT
        time_bucket(INTERVAL '15 min', ts) AS bucket,
        device, tag, domain, phase, channel
    FROM _affected_energy_keys
) affected
WHERE rollup.bucket = affected.bucket
  AND rollup.device = affected.device
  AND rollup.tag = affected.tag
  AND rollup.domain = affected.domain
  AND rollup.phase IS NOT DISTINCT FROM affected.phase
  AND rollup.channel IS NOT DISTINCT FROM affected.channel;

SELECT device_em.fn_append_energy_15min(
    array_agg(device ORDER BY ts, device, tag, phase, channel),
    array_agg(tag::VARCHAR(30) ORDER BY ts, device, tag, phase, channel),
    array_agg(domain ORDER BY ts, device, tag, phase, channel),
    array_agg(phase ORDER BY ts, device, tag, phase, channel),
    array_agg(channel ORDER BY ts, device, tag, phase, channel),
    array_agg(extract(epoch FROM ts)::BIGINT ORDER BY ts, device, tag, phase, channel),
    array_agg(0::REAL ORDER BY ts, device, tag, phase, channel)
)
FROM _affected_energy_keys
HAVING count(*) > 0;

COMMIT;
SQL
    } | docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
        -v ON_ERROR_STOP=1 -v "requested_json=$requested_json" >/dev/null
    ok "[energy-seed] Simulator meter history seeded."
}
