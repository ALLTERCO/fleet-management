#!/usr/bin/env bash
# Runs the scoped automation system proof against a local stack with real Zitadel.
# Usage: scoped-automation-zitadel-check.sh <compose-project> <state-dir> [report.json]
set -euo pipefail

PROJECT="${1:?compose project name, e.g. nrlocal}"
STATE_DIR="${2:?deploy state directory of that stack}"
OUTPUT="${3:-}"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

env_value() {
    local value
    value="$(grep -E "^$2=" "$STATE_DIR/$1" | tail -n 1 | cut -d= -f2-)"
    value="${value%\"}"
    value="${value#\"}"
    [ -n "$value" ] || { echo "$2 missing from $STATE_DIR/$1" >&2; exit 1; }
    printf '%s' "$value"
}

# Empty when the stack does not set it; the proof then assumes the code default.
optional_env_value() {
    { grep -E "^$2=" "$STATE_DIR/$1" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2- | tr -d '"'
}

container_ip() {
    docker inspect "$PROJECT-$1-1" \
        --format "{{with index .NetworkSettings.Networks \"${PROJECT}_fleet-net\"}}{{.IPAddress}}{{end}}"
}

# The stack's published Zitadel API port (deploy env ZITADEL_API_HOST_PORT).
ZITADEL_API_URL="${ZITADEL_API_URL:-http://127.0.0.1:8091}"
FLEET_IP="$(container_ip fleet-manager)"
NODE_RED_IP="$(container_ip nodered)"
DB_IP="$(container_ip fleet-db)"
for value in "$FLEET_IP" "$NODE_RED_IP" "$DB_IP"; do
    [ -n "$value" ] || { echo "stack $PROJECT is not running with Node-RED" >&2; exit 1; }
done

cd "$BACKEND_DIR"
exec env \
    FM_SCOPED_SYSTEM_BASE_URL="http://$FLEET_IP:7011" \
    FM_SCOPED_SYSTEM_SIMULATOR_WS_URL="ws://$FLEET_IP:7011/shelly" \
    FM_SCOPED_SYSTEM_NODE_RED_URL="http://$NODE_RED_IP:1880/node-red/red" \
    FM_SCOPED_SYSTEM_NODE_RED_PROXY_SECRET="$(env_value nodered-runtime.env FM_NODE_RED_PROXY_SECRET)" \
    FM_SCOPED_SYSTEM_NODE_RED_SERVICE_TOKEN="$(env_value nodered-runtime.env FM_NODE_RED_SERVICE_TOKEN)" \
    FM_SCOPED_SYSTEM_DB_HOST="$DB_IP" \
    FM_SCOPED_SYSTEM_DB_PORT=5432 \
    FM_SCOPED_SYSTEM_DB_PASSWORD="$(env_value .env POSTGRES_PASSWORD)" \
    FM_SCOPED_SYSTEM_ZITADEL_URL="$ZITADEL_API_URL" \
    FM_SCOPED_SYSTEM_ZITADEL_HOST="$(env_value .env ZITADEL_HOSTNAME)" \
    FM_SCOPED_SYSTEM_ZITADEL_TOKEN="$(env_value zitadel.env ZITADEL_SERVICE_TOKEN)" \
    FM_SCOPED_SYSTEM_ZITADEL_ORG_ID="$(env_value zitadel.env FM_CLIENT_ORG_ID)" \
    FM_SCOPED_SYSTEM_ZITADEL_PROJECT_ID="$(env_value zitadel.env ZITADEL_CLIENT_PROJECT_ID)" \
    FM_SCOPED_SYSTEM_OUTPUT="$OUTPUT" \
    FM_SCOPED_SYSTEM_ACCOUNT_STATE_TTL_MS="${FM_SCOPED_SYSTEM_ACCOUNT_STATE_TTL_MS:-$(optional_env_value .env FM_ACCOUNT_STATE_TTL_MS)}" \
    node --import tsx scripts/scoped-automation-system.ts
