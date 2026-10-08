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
    local url="${FM_BASE_URL%/}/health/ready"
    local attempts="${FM_SEED_READY_RETRIES:-60}"
    local i=0 code
    while [ "$i" -lt "$attempts" ]; do
        # curl emits '000' on connection failure; || true satisfies set -e.
        code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$url" \
            2>/dev/null || true)
        case "${code:-000}" in
            2??)
                return 0
                ;;
            *) ;;
        esac
        i=$((i + 1))
        sleep 2
    done
    error "Fleet Manager not reachable through the gateway at $FM_BASE_URL after ${attempts} tries"
    return 1
}

_seed_validate_environment() {
    # bm-demo is a Business Manager demo platform: its whole reason to exist is
    # the seeded fixture, and the launcher asks for it on purpose.
    case "${FM_ENVIRONMENT_ID:-${ENV_NAME:-}}" in
        dev|local|office-test|cloud-test|public|bm-demo) return 0 ;;
        *)
            error "Demo seed is not allowed in ${FM_ENVIRONMENT_ID:-${ENV_NAME:-unknown}}."
            return 1
            ;;
    esac
}

# A customer-shaped fixture owns every object its story shows, so the generic
# office demo furniture (tags, demo groups, demo virtual devices, demo certs)
# is scenery its operator never created. Opt out with "genericDemo": false;
# a fixture without the key keeps the demo objects.
_seed_generic_demo_enabled() {
    local fixture="${DEPLOY_DIR:-}/seed/${FM_SEED_PROFILE:-}.json"
    [ -n "${DEPLOY_DIR:-}" ] && [ -n "${FM_SEED_PROFILE:-}" ] \
        && [ -f "$fixture" ] || return 0
    ! jq -e '.genericDemo == false' "$fixture" >/dev/null 2>&1
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
    resp=$(_seed_post_json "$FM_BASE_URL/rpc" \
        "{\"method\":\"User.Authenticate\",\"params\":{\"username\":\"$user\",\"password\":\"$pass\"}}")
    FM_SEED_TOKEN=$(echo "$resp" | jq -r '.access_token // empty')
    if [ -z "$FM_SEED_TOKEN" ]; then
        error "User.Authenticate failed at $FM_BASE_URL"
        error "Response: $resp"
        return 1
    fi
}

_seed_post_json() {
    local url="$1" body="$2" authorization="${3:-}"
    local attempts="${FM_SEED_RPC_ATTEMPTS:-6}" attempt=1 response status
    local retry_delay="${FM_SEED_RPC_RETRY_DELAY_SECONDS:-1}"
    local -a headers=(-H 'Content-Type: application/json')
    if [ -n "$authorization" ]; then
        headers+=(-H "Authorization: $authorization")
    fi
    while true; do
        if response=$(curl -sk --connect-timeout 5 --max-time 60 \
            -X POST "$url" "${headers[@]}" -d "$body"); then
            printf '%s' "$response"
            return 0
        else
            status=$?
        fi
        if [ "$attempt" -ge "$attempts" ]; then
            return "$status"
        fi
        attempt=$((attempt + 1))
        sleep "$retry_delay"
    done
}

_seed_rpc() {
    local method="$1" body="$2"
    _seed_post_json "$FM_BASE_URL/rpc/$method" "$body" \
        "Bearer $FM_SEED_TOKEN"
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

_seed_fixture_simulator_profiles_json() {
    local fixture="$1"
    if [ -n "${FM_SEED_SIMULATOR_DEVICE_PROFILES:-}" ]; then
        jq -Rsc '
            split(",")
            | map(gsub("^\\s+|\\s+$"; ""))
            | map(select(length > 0))
        ' <<<"$FM_SEED_SIMULATOR_DEVICE_PROFILES"
        return
    fi
    jq -c '
        .simulator.profiles as $profiles
        | if ($profiles | type) == "object" then
            [$profiles | to_entries[] | .key as $key | range(.value) | $key]
          elif ($profiles | type) == "array" then $profiles
          else [] end
    ' "$fixture"
}

_seed_wait_for_requested_devices() {
    local expected="${FM_SEED_DEVICE_IDS_JSON:-[]}" attempts i=0
    attempts="${FM_SEED_DEVICE_WAIT_ATTEMPTS:-60}"
    if ! jq -e 'type == "array" and length > 0' <<<"$expected" >/dev/null; then
        return 0
    fi

    info "Waiting for simulated devices to reach Fleet Manager..."
    while [ "$i" -lt "$attempts" ]; do
        local devices pending present missing
        devices=$(_seed_rpc 'Device.List' '{"limit":0}')
        pending=$(_seed_rpc 'WaitingRoom.List' '{"limit":500,"state":"open"}')
        # Feed the (potentially huge) device and waiting-room lists to jq on
        # stdin, not as argv — a full Device.List on a busy env overflows
        # ARG_MAX when passed via --argjson.
        present=$(printf '%s\n%s\n' "$devices" "$pending" | jq -sc '
                [(.[0].items[]?.shellyID), (.[1].items[]?.shellyID)]
                | unique
            ')
        missing=$(jq -c --argjson expected "$expected" '$expected - .' <<<"$present")
        if [ "$(jq 'length' <<<"$missing")" -eq 0 ]; then
            info "  All requested simulator devices are available."
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done

    error "Simulator devices did not arrive: $(jq -r 'join(", ")' <<<"$missing")"
    return 1
}

_seed_wait_for_requested_devices_online() {
    local expected="${FM_SEED_DEVICE_IDS_JSON:-[]}" attempts i=0 missing='[]'
    attempts="${FM_SEED_DEVICE_WAIT_ATTEMPTS:-60}"
    if ! jq -e 'type == "array" and length > 0' <<<"$expected" >/dev/null; then
        return 0
    fi

    while [ "$i" -lt "$attempts" ]; do
        local devices online
        devices=$(_seed_rpc 'Device.List' '{"limit":0}')
        online=$(jq '[.items[]? | select(.presence == "online") | .shellyID] | unique' \
            <<<"$devices")
        missing=$(jq -cn --argjson expected "$expected" --argjson online "$online" \
            '$expected - $online')
        if [ "$(jq 'length' <<<"$missing")" -eq 0 ]; then
            info "  All requested simulator devices are online."
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done

    error "Simulator devices did not become online: $(jq -r 'join(", ")' <<<"$missing")"
    return 1
}

_seed_wait_for_requested_blu_devices() {
    local expected="${FM_SEED_BLU_DEVICE_IDS_JSON:-[]}" attempts i=0 missing='[]'
    attempts="${FM_SEED_DEVICE_WAIT_ATTEMPTS:-60}"
    if ! jq -e 'type == "array" and length > 0' <<<"$expected" >/dev/null; then
        return 0
    fi

    while [ "$i" -lt "$attempts" ]; do
        local devices present
        devices=$(_seed_rpc 'VirtualDevice.Bluetooth.List' '{"limit":1000}')
        present=$(jq '[.items[]?.externalId] | unique' <<<"$devices")
        missing=$(jq -cn --argjson expected "$expected" --argjson present "$present" \
            '$expected - $present')
        if [ "$(jq 'length' <<<"$missing")" -eq 0 ]; then
            info "  All requested BLU devices are available."
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done

    error "Simulator BLU devices did not arrive: $(jq -r 'join(", ")' <<<"$missing")"
    return 1
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
    _seed_reconcile_managed_simulator_bluetooth
    _seed_reset_locations
    _seed_delete_managed_dashboards
}

_seed_validate_bluetooth_inventory() {
    jq -e '
        type == "array"
        and all(.[]; type == "string" and length > 0)
        and length == (unique | length)
    ' >/dev/null 2>&1
}

# API inventory alone is not ownership proof, so first runs delete nothing.
_seed_reconcile_managed_simulator_bluetooth() {
    local desired="${FM_SEED_BLU_DEVICE_IDS_JSON:-[]}"
    local managed="${FM_SEED_MANAGED_BLU_DEVICES_JSON:-[]}"
    local devices stale

    if ! _seed_validate_bluetooth_inventory <<<"$desired"; then
        error "Desired simulator BLU inventory must contain unique, non-empty device IDs."
        return 1
    fi
    if ! jq -e '
        type == "array"
        and all(.[];
            type == "object"
            and (.externalId | type == "string" and length > 0)
            and (.deviceListId | type == "number" and floor == . and . > 0)
            and (.stableId | type == "string" and length > 0)
        )
        and (map(.externalId) | length) == (map(.externalId) | unique | length)
    ' <<<"$managed" >/dev/null 2>&1; then
        error "Managed simulator BLU ownership identities are invalid."
        return 1
    fi
    if [ "$(jq 'length' <<<"$managed")" -eq 0 ]; then
        return 0
    fi

    devices=$(_seed_rpc 'VirtualDevice.Bluetooth.List' '{"limit":0}')
    if ! jq -e '.items | type == "array"' <<<"$devices" >/dev/null 2>&1; then
        error "Could not list BLU devices while reconciling simulator ownership."
        return 1
    fi
    stale=$(jq -r --argjson desired "$desired" --argjson managed "$managed" '
        $managed[] as $owned
        | select($desired | index($owned.externalId) | not)
        | .items[]?
        | select(
            .externalId == $owned.externalId
            and .deviceListId == $owned.deviceListId
            and .stableId == $owned.stableId
        )
        | .externalId
    ' <<<"$devices")

    local id body response deleted=0
    while IFS= read -r id; do
        [ -z "$id" ] && continue
        body=$(jq -cn --arg id "$id" \
            '{externalId:$id,retention:"purge",unpairFromGateway:false}')
        response=$(_seed_rpc 'VirtualDevice.Bluetooth.Delete' "$body")
        if ! jq -e '.deleted == true' <<<"$response" >/dev/null; then
            error "Failed to purge managed simulator BLU child $id"
            return 1
        fi
        deleted=$((deleted + 1))
    done <<<"$stale"
    if [ "$deleted" -gt 0 ]; then
        info "Purged $deleted stale managed simulator BLU child device(s)."
    fi
    return 0
}

_seed_configure_simulated_bluetooth() {
    local expected="${FM_SEED_BLU_DEVICE_IDS_JSON:-[]}" devices targets
    if ! jq -e 'type == "array" and length > 0' <<<"$expected" >/dev/null; then
        return 0
    fi

    _seed_wait_for_requested_blu_devices || return 1
    devices=$(_seed_rpc 'VirtualDevice.Bluetooth.List' '{"limit":1000}')
    targets=$(jq -r --argjson expected "$expected" '
        .items[]?
        | select(.externalId as $id | $expected | index($id))
        | select(.capability == "controllable" and .keyRefSet == false)
        | .externalId
    ' <<<"$devices")

    local id body response configured=0
    while IFS= read -r id; do
        [ -z "$id" ] && continue
        body=$(jq -cn --arg id "$id" \
            '{externalId:$id,keyRef:("dev/simulator/" + $id),reason:"simulated pairing"}')
        response=$(_seed_rpc 'VirtualDevice.Bluetooth.Key.SetRef' "$body")
        if ! jq -e '.keyRefSet == true' <<<"$response" >/dev/null; then
            error "Failed to pair simulated BLU device $id"
            return 1
        fi
        configured=$((configured + 1))
    done <<<"$targets"
    if [ "$configured" -gt 0 ]; then
        info "Paired $configured simulated BLU control device(s)."
    fi
    return 0
}
