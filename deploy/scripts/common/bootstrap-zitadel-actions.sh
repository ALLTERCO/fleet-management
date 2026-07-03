#!/usr/bin/env bash
# Registers Action V2 targets. --rotate recreates them, snapshotting old keys.
# shellcheck disable=SC2034  # CACHED_*/PREVIOUS_* read by name in ensure_target

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=/dev/null
source "$SCRIPT_DIR/zitadel-lib.sh"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/zitadel-events.sh"

ROTATE=0
for arg in "$@"; do
    case "$arg" in
        --rotate) ROTATE=1 ;;
    esac
done

ZITADEL_URL="${ZITADEL_URL:?ZITADEL_URL is required}"
MACHINEKEY_PATH="${MACHINEKEY_PATH:?MACHINEKEY_PATH is required}"
STATE_FILE="${STATE_FILE:-$DEPLOY_DIR/state/zitadel.env}"
ZITADEL_PROJECT_NAME="${ZITADEL_PROJECT_NAME:?ZITADEL_PROJECT_NAME is required}"

ACTION_WEBHOOK_TIMEOUT="${FM_ACTION_WEBHOOK_TIMEOUT:-5s}"

# Read STATE_FILE var lines (portable BSD/GNU).
read_state() {
    sed -n "s/^$1=//p" "$STATE_FILE" 2>/dev/null | head -1 || true
}

action_search_target() {
    local name="$1"
    local body response
    body=$(jq -cn --arg name "$name" \
        '{filters:[{targetNameFilter:{targetName:$name,method:"TEXT_FILTER_METHOD_EQUALS"}}]}')
    response=$(zitadel_api "POST" "/v2beta/actions/targets/search" \
        "$body" "$TOKEN" "$ZITADEL_URL")
    echo "$response" | jq -r '(.targets // []) | .[0] // empty'
}

action_create_target() {
    local name="$1" endpoint="$2"
    local body
    body=$(jq -cn \
        --arg name "$name" \
        --arg endpoint "$endpoint" \
        --arg timeout "$ACTION_WEBHOOK_TIMEOUT" \
        '{name:$name,endpoint:$endpoint,timeout:$timeout,restCall:{interruptOnError:false}}')
    zitadel_api "POST" "/v2beta/actions/targets" \
        "$body" "$TOKEN" "$ZITADEL_URL"
}

action_delete_target() {
    local id="$1"
    zitadel_api "DELETE" "/v2beta/actions/targets/${id}" "" "$TOKEN" "$ZITADEL_URL"
}

bind_event_execution() {
    local event="$1" target="$2"
    echo "  Setting execution: event:${event} -> ${target}"
    local body response
    body=$(jq -cn --arg event "$event" --arg target "$target" \
        '{condition:{event:{event:$event}},targets:[$target]}')
    response=$(zitadel_api "PUT" "/v2beta/actions/executions" \
        "$body" "$TOKEN" "$ZITADEL_URL")
    if ! echo "$response" | jq -e '.setDate' >/dev/null 2>&1; then
        echo "ERROR: failed to bind execution for $event" >&2
        echo "$response" >&2
        exit 1
    fi
}

# Reuse target if cached signing key matches; else recreate (Zitadel does
# not return signing keys on read).
ensure_target() {
    local label="$1" name="$2" endpoint="$3"
    local cached_id_var="$4" cached_key_var="$5"
    local out_id_var="$6" out_key_var="$7"

    # shellcheck disable=SC2034  # vars consumed via indirect expansion below
    local cached_id="${!cached_id_var:-}"
    # shellcheck disable=SC2034
    local cached_key="${!cached_key_var:-}"
    local existing target_id="" signing_key=""

    existing=$(action_search_target "$name" || echo "")
    if [ -n "$existing" ]; then
        target_id=$(echo "$existing" | jq -r '.id // empty')
        if [ -n "$cached_key" ] && [ "$cached_id" = "$target_id" ]; then
            signing_key="$cached_key"
            echo "  $label target exists: $target_id (cached signing key)"
        else
            echo "  $label target exists ($target_id) but signing key not cached — recreating..."
            action_delete_target "$target_id" >/dev/null 2>&1 || true
            target_id=""
        fi
    fi

    if [ -z "$target_id" ]; then
        echo "  Creating $label target..."
        local resp
        resp=$(action_create_target "$name" "$endpoint")
        target_id=$(echo "$resp" | jq -r '.id // empty')
        signing_key=$(echo "$resp" | jq -r '.signingKey // empty')
        if [ -z "$target_id" ] || [ -z "$signing_key" ]; then
            echo "ERROR: failed to create $label target" >&2
            echo "$resp" >&2
            exit 1
        fi
        echo "  Created $label target: $target_id"
    fi

    printf -v "$out_id_var" '%s' "$target_id"
    printf -v "$out_key_var" '%s' "$signing_key"
}

# --- GDPR cascade target — clears FM tenant data on user.removed --------------
GDPR_TARGET_NAME="${ZITADEL_PROJECT_NAME}${ZITADEL_TARGET_SUFFIX_USER_REMOVED}"
GDPR_WEBHOOK_ENDPOINT="${FM_GDPR_WEBHOOK_ENDPOINT:-http://fleet-manager:7011/api/zitadel/actions/user-removed}"

# --- Grant-removed target — invalidates FM userinfo + V2 shape on grant flux --
GRANT_TARGET_NAME="${ZITADEL_PROJECT_NAME}${ZITADEL_TARGET_SUFFIX_GRANT_REMOVED}"
GRANT_WEBHOOK_ENDPOINT="${FM_GRANT_WEBHOOK_ENDPOINT:-http://fleet-manager:7011/api/zitadel/actions/grant-removed}"

echo "=== Action V2: GDPR + Grant-Removed Webhooks ==="
echo "  GDPR target:  $GDPR_TARGET_NAME -> $GDPR_WEBHOOK_ENDPOINT"
echo "  Grant target: $GRANT_TARGET_NAME -> $GRANT_WEBHOOK_ENDPOINT"

CACHED_GDPR_TARGET_ID=""
CACHED_GDPR_SIGNING_KEY=""
CACHED_GRANT_TARGET_ID=""
CACHED_GRANT_SIGNING_KEY=""
PREVIOUS_GDPR_SIGNING_KEY=""
PREVIOUS_GRANT_SIGNING_KEY=""
if [ -f "$STATE_FILE" ]; then
    CACHED_GDPR_TARGET_ID=$(read_state FM_ZITADEL_GDPR_TARGET_ID)
    CACHED_GDPR_SIGNING_KEY=$(read_state FM_ZITADEL_GDPR_SIGNING_KEY)
    CACHED_GRANT_TARGET_ID=$(read_state FM_ZITADEL_GRANT_TARGET_ID)
    CACHED_GRANT_SIGNING_KEY=$(read_state FM_ZITADEL_GRANT_SIGNING_KEY)
fi

# Snapshot live keys into PREVIOUS, then drop cache so recreate paths run.
if [ "$ROTATE" = "1" ]; then
    echo "  Rotation requested — snapshotting current keys as PREVIOUS"
    PREVIOUS_GDPR_SIGNING_KEY="$CACHED_GDPR_SIGNING_KEY"
    PREVIOUS_GRANT_SIGNING_KEY="$CACHED_GRANT_SIGNING_KEY"
    CACHED_GDPR_TARGET_ID=""
    CACHED_GDPR_SIGNING_KEY=""
    CACHED_GRANT_TARGET_ID=""
    CACHED_GRANT_SIGNING_KEY=""
fi

TOKEN=$(zitadel_get_token "$MACHINEKEY_PATH" "$ZITADEL_URL")

GDPR_TARGET_ID=""
GDPR_SIGNING_KEY=""
ensure_target "GDPR" "$GDPR_TARGET_NAME" "$GDPR_WEBHOOK_ENDPOINT" \
    CACHED_GDPR_TARGET_ID CACHED_GDPR_SIGNING_KEY \
    GDPR_TARGET_ID GDPR_SIGNING_KEY

GRANT_TARGET_ID=""
GRANT_SIGNING_KEY=""
ensure_target "Grant" "$GRANT_TARGET_NAME" "$GRANT_WEBHOOK_ENDPOINT" \
    CACHED_GRANT_TARGET_ID CACHED_GRANT_SIGNING_KEY \
    GRANT_TARGET_ID GRANT_SIGNING_KEY

bind_event_execution "$ZITADEL_EVT_USER_REMOVED" "$GDPR_TARGET_ID"
bind_event_execution "$ZITADEL_EVT_USER_GRANT_REMOVED" "$GRANT_TARGET_ID"
bind_event_execution "$ZITADEL_EVT_USER_GRANT_CASCADE_REMOVED" "$GRANT_TARGET_ID"

# Persist target IDs + signing keys to the existing zitadel.env state file
# (replaces lines if present, appends if absent).
TEMP_STATE=$(mktemp)
trap 'rm -f "$TEMP_STATE"' EXIT
if [ -f "$STATE_FILE" ]; then
    grep -vE '^FM_ZITADEL_(ACTION|GDPR|GRANT)_(TARGET_ID|SIGNING_KEY|SIGNING_KEY_PREVIOUS)=' "$STATE_FILE" > "$TEMP_STATE" || true
else
    : > "$TEMP_STATE"
fi
{
    echo "FM_ZITADEL_GDPR_TARGET_ID=${GDPR_TARGET_ID}"
    echo "FM_ZITADEL_GDPR_SIGNING_KEY=${GDPR_SIGNING_KEY}"
    echo "FM_ZITADEL_GDPR_SIGNING_KEY_PREVIOUS=${PREVIOUS_GDPR_SIGNING_KEY}"
    echo "FM_ZITADEL_GRANT_TARGET_ID=${GRANT_TARGET_ID}"
    echo "FM_ZITADEL_GRANT_SIGNING_KEY=${GRANT_SIGNING_KEY}"
    echo "FM_ZITADEL_GRANT_SIGNING_KEY_PREVIOUS=${PREVIOUS_GRANT_SIGNING_KEY}"
} >> "$TEMP_STATE"
chmod 0600 "$TEMP_STATE"
mv "$TEMP_STATE" "$STATE_FILE"
echo "  State updated: $STATE_FILE"

echo "=== Action V2 bootstrap complete ==="
