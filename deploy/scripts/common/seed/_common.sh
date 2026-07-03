#!/usr/bin/env bash
# Shared seed helpers — RPC, auth bootstrap, idempotency marker.
# Sourced first by seed-lib.sh before any other module.

set -euo pipefail

# Fallback shims — outer callers usually provide these. Only declare if missing.
if ! declare -F info  >/dev/null; then info()  { echo "[INFO]  $*"; }; fi
if ! declare -F error >/dev/null; then error() { echo "[ERROR] $*" >&2; }; fi
if ! declare -F ok    >/dev/null; then ok()    { echo "[OK]    $*"; }; fi
if ! declare -F detect_host_ip >/dev/null; then
    detect_host_ip() { echo "localhost"; }
fi

seed_load_base_url() {
    local dev="${1:-false}"
    if [ -n "${FM_SEED_URL:-}" ]; then
        FM_BASE_URL="$FM_SEED_URL"
    elif [ "$dev" = "true" ]; then
        FM_BASE_URL="http://localhost:${FLEET_MANAGER_PORT:-7011}"
    elif [ -n "${CLOUD_TEST_PUBLIC_HOST:-}" ]; then
        FM_BASE_URL="https://${CLOUD_TEST_PUBLIC_HOST}"
    elif [ -n "${FM_HOSTNAME:-}" ] && [ "${FM_HOSTNAME}" != "localhost" ]; then
        # Use the host the stack was configured for (cert + Traefik route). The
        # caller resolves + validates it live, so this can't be a dead IP; and
        # the default-route IP may differ from the chosen serving IP.
        FM_BASE_URL="https://${FM_HOSTNAME}"
    else
        FM_BASE_URL="https://$(detect_host_ip)"
    fi
}

# Wait until FM answers through the gateway: after a restart the container can be
# healthy while Traefik hasn't reattached the route, so an early seed 502s.
seed_wait_until_ready() {
    : "${FM_BASE_URL:?FM_BASE_URL not set; call seed_load_base_url first}"
    local url="${FM_BASE_URL%/}/api/health"
    local attempts="${FM_SEED_READY_RETRIES:-60}"
    local i=0 code
    while [ "$i" -lt "$attempts" ]; do
        # curl emits '000' on connection failure; || true satisfies set -e.
        code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$url" \
            2>/dev/null || true)
        case "${code:-000}" in
            000 | 502 | 503 | 504) ;;
            *)
                return 0
                ;;
        esac
        i=$((i + 1))
        sleep 2
    done
    error "Fleet Manager not reachable through the gateway at $FM_BASE_URL after ${attempts} tries"
    return 1
}

seed_load_token_zitadel() {
    export FM_SEED_AUTH_MODE=zitadel
    local zitadel_env="$DEPLOY_DIR/state/zitadel.env"
    if [ ! -f "$zitadel_env" ]; then
        error "deploy/state/zitadel.env not found — run 'up' first."
        return 1
    fi
    FM_SEED_TOKEN=$(grep '^ZITADEL_SERVICE_TOKEN=' "$zitadel_env" \
        | cut -d= -f2-)
    if [ -z "$FM_SEED_TOKEN" ]; then
        error "ZITADEL_SERVICE_TOKEN missing — bootstrap incomplete."
        return 1
    fi
}

# Dev-mode admin/admin login via the unauth POST /rpc body bypass.
seed_load_token_dev() {
    export FM_SEED_AUTH_MODE=dev
    : "${FM_BASE_URL:?FM_BASE_URL not set; call seed_load_base_url first}"
    local user="${FM_SEED_DEV_USER:-admin}"
    local pass="${FM_SEED_DEV_PASSWORD:-admin}"
    local resp
    resp=$(curl -sk -X POST "$FM_BASE_URL/rpc" \
        -H 'Content-Type: application/json' \
        -d "{\"method\":\"User.Authenticate\",\"params\":{\"username\":\"$user\",\"password\":\"$pass\"}}")
    FM_SEED_TOKEN=$(echo "$resp" | jq -r '.access_token // empty')
    if [ -z "$FM_SEED_TOKEN" ]; then
        error "User.Authenticate failed at $FM_BASE_URL"
        error "Response: $resp"
        return 1
    fi
}

_seed_rpc() {
    local method="$1" body="$2"
    curl -sk -X POST "$FM_BASE_URL/rpc/$method" \
        -H "Authorization: Bearer $FM_SEED_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$body"
}

# Issue an RPC and log success / skipped / error per the response shape
# so silent failures (error envelope, permission denied, duplicate) are
# visible. Use when the call site doesn't need the response body.
_seed_rpc_log() {
    local method="$1" body="$2" label="$3" resp err
    resp=$(_seed_rpc "$method" "$body")
    err=$(echo "$resp" | jq -r '.error.message // empty' 2>/dev/null)
    if [ -n "$err" ]; then
        info "$label — skipped: $err"
        return 1
    fi
    info "$label"
}

# Idempotency marker — Sofia HQ building present means demo data is in place.
_seed_already_seeded() {
    local payload sofia_name
    sofia_name=$(_seed_offices_data | jq -r '.[0].buildingName')
    payload=$(_seed_rpc 'Location.List' '{"limit":500}')
    echo "$payload" | jq -e --arg n "$sofia_name" \
        '.items[]? | select(.name == $n and .kind == "building")' \
        >/dev/null 2>&1
}

_seed_reset() {
    _seed_reset_locations
    local dashboards
    dashboards=$(_seed_rpc 'Dashboard.List' '{}' \
        | jq -r '.items[]? | select(.name=="Energy Overview" or .name=="Office Status") | .id')
    for id in $dashboards; do
        _seed_rpc 'Dashboard.Delete' "{\"id\":$id}" >/dev/null || true
    done
}
