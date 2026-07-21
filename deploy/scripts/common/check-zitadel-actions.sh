#!/usr/bin/env bash
# Verifies the Zitadel Action V2 wiring FM needs for delete/revoke events.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=deploy/scripts/common/zitadel-lib.sh
source "$SCRIPT_DIR/zitadel-lib.sh"
# shellcheck source=deploy/scripts/common/zitadel-events.sh
source "$SCRIPT_DIR/zitadel-events.sh"

MODE="status"
if [ "${1:-}" = "--quiet" ]; then
    MODE="quiet"
fi

ZITADEL_URL="${ZITADEL_URL:?ZITADEL_URL is required}"
MACHINEKEY_PATH="${MACHINEKEY_PATH:?MACHINEKEY_PATH is required}"
STATE_FILE="${STATE_FILE:-$DEPLOY_DIR/state/zitadel.env}"
ZITADEL_PROJECT_NAME="${ZITADEL_PROJECT_NAME:?ZITADEL_PROJECT_NAME is required}"

read_state() {
    sed -n "s/^$1=//p" "$STATE_FILE" 2>/dev/null | head -1 || true
}

say() {
    [ "$MODE" = "quiet" ] || printf '  %s\n' "$*"
}

fail_check() {
    say "FAIL: $*"
    return 1
}

action_search_target() {
    local name="$1"
    local body
    body=$(jq -cn --arg name "$name" \
        '{filters:[{targetNameFilter:{targetName:$name,method:"TEXT_FILTER_METHOD_EQUALS"}}]}')
    zitadel_api "POST" "/v2beta/actions/targets/search" \
        "$body" "$TOKEN" "$ZITADEL_URL"
}

action_list_executions() {
    zitadel_api "POST" "/v2/actions/executions/search" \
        '{"pagination":{"limit":200}}' "$TOKEN" "$ZITADEL_URL"
}

target_id_by_name() {
    local name="$1"
    action_search_target "$name" | jq -r '(.targets // []) | .[0].id // empty'
}

execution_has_target() {
    local executions="$1" event="$2" target="$3"
    printf '%s' "$executions" | jq -e --arg event "$event" --arg target "$target" '
        (.executions // []) | any(
            (
                .condition.event.all == true
                or .condition.event.event == $event
                or ((.condition.event.events // []) | index($event))
            )
            and ((.targets // []) | index($target))
        )
    ' >/dev/null
}

check_state_value() {
    local key="$1"
    local value
    value="$(read_state "$key")"
    [ -n "$value" ] || fail_check "$key missing from $STATE_FILE"
}

check_runtime_value() {
    local key="$1"
    local file="${FM_RUNTIME_ENV_FILE:-}"
    local value
    [ -n "$file" ] || return 0
    if [ ! -f "$file" ]; then
        fail_check "runtime config missing: $file"
        return 1
    fi
    value="$(sed -n "s/^$key=//p" "$file" 2>/dev/null | head -1 || true)"
    if [ -z "$value" ]; then
        fail_check "$key missing from $file"
        return 1
    fi
}

check_event() {
    local executions="$1" event="$2" target="$3"
    if execution_has_target "$executions" "$event" "$target"; then
        say "OK: event $event -> $target"
    else
        fail_check "event $event is not bound to $target"
    fi
}

main() {
    local gdpr_name grant_name gdpr_state_id grant_state_id gdpr_live_id grant_live_id
    local executions failed=0

    gdpr_name="${ZITADEL_PROJECT_NAME}${ZITADEL_TARGET_SUFFIX_USER_REMOVED}"
    grant_name="${ZITADEL_PROJECT_NAME}${ZITADEL_TARGET_SUFFIX_GRANT_REMOVED}"

    check_state_value FM_ZITADEL_GDPR_TARGET_ID || failed=1
    check_state_value FM_ZITADEL_GDPR_SIGNING_KEY || failed=1
    check_state_value FM_ZITADEL_GRANT_TARGET_ID || failed=1
    check_state_value FM_ZITADEL_GRANT_SIGNING_KEY || failed=1
    check_runtime_value FM_ZITADEL_GDPR_SIGNING_KEY || failed=1
    check_runtime_value FM_ZITADEL_GRANT_SIGNING_KEY || failed=1

    gdpr_state_id="$(read_state FM_ZITADEL_GDPR_TARGET_ID)"
    grant_state_id="$(read_state FM_ZITADEL_GRANT_TARGET_ID)"

    TOKEN=$(zitadel_get_token "$MACHINEKEY_PATH" "$ZITADEL_URL")

    gdpr_live_id="$(target_id_by_name "$gdpr_name")"
    grant_live_id="$(target_id_by_name "$grant_name")"

    if [ -n "$gdpr_live_id" ] && [ "$gdpr_live_id" = "$gdpr_state_id" ]; then
        say "OK: GDPR target exists ($gdpr_live_id)"
    else
        fail_check "GDPR target mismatch: state=${gdpr_state_id:-missing} live=${gdpr_live_id:-missing}" || failed=1
    fi

    if [ -n "$grant_live_id" ] && [ "$grant_live_id" = "$grant_state_id" ]; then
        say "OK: grant target exists ($grant_live_id)"
    else
        fail_check "grant target mismatch: state=${grant_state_id:-missing} live=${grant_live_id:-missing}" || failed=1
    fi

    executions="$(action_list_executions)"
    for binding in "${ZITADEL_ACTION_BINDINGS[@]}"; do
        lane="${binding%%:*}"
        event="${binding#*:}"
        case "$lane" in
            gdpr) target_id="$gdpr_state_id" ;;
            grant) target_id="$grant_state_id" ;;
            *)
                say "FAIL: unknown Action V2 binding lane: $lane"
                failed=1
                continue
                ;;
        esac
        check_event "$executions" "$event" "$target_id" || failed=1
    done

    [ "$failed" -eq 0 ]
}

main
