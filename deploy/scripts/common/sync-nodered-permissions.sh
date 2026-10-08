#!/usr/bin/env bash
# Re-applies the Node-RED service account's permissions without a full
# bootstrap: Zitadel metadata plus the saved operator list in the state file.
# Public up and upgrade run it; private up runs the full bootstrap every time.
#
# Env: ZITADEL_URL, MACHINEKEY_PATH, STATE_FILE (required),
#      ZITADEL_HOST_HEADER, FM_NODE_RED_PERMISSIONS (optional operator list).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=deploy/scripts/common/zitadel-lib.sh
source "$SCRIPT_DIR/zitadel-lib.sh"
# shellcheck source=deploy/scripts/common/zitadel/users.sh
source "$SCRIPT_DIR/zitadel/users.sh"

# Replaces FM_NODE_RED_PERMISSIONS in the state file, keeping its mode.
save_node_red_permission_override() {
    local value="$1" tmp
    tmp="$(mktemp "${STATE_FILE}.XXXXXX")"
    grep -v '^FM_NODE_RED_PERMISSIONS=' "$STATE_FILE" >"$tmp" || true
    printf 'FM_NODE_RED_PERMISSIONS=%s\n' "$value" >>"$tmp"
    chmod 0600 "$tmp"
    mv "$tmp" "$STATE_FILE"
}

sync_node_red_permissions() {
    ZITADEL_URL="${ZITADEL_URL:?ZITADEL_URL is required}"
    MACHINEKEY_PATH="${MACHINEKEY_PATH:?MACHINEKEY_PATH is required}"
    STATE_FILE="${STATE_FILE:?STATE_FILE is required}"

    NODE_RED_SERVICE_USER_ID="$(state_var FM_NODE_RED_SERVICE_USER_ID)"
    if [ -z "$NODE_RED_SERVICE_USER_ID" ]; then
        echo "  No Node-RED service account in $STATE_FILE; nothing to sync"
        return 0
    fi
    NODE_RED_PERMISSIONS="$(node_red_permission_override)"
    if ! TOKEN=$(zitadel_get_token "$MACHINEKEY_PATH" "$ZITADEL_URL" 2>/dev/null); then
        echo "ERROR: Could not authenticate with the first-instance machinekey" >&2
        return 1
    fi
    write_node_red_service_metadata
    save_node_red_permission_override "$NODE_RED_PERMISSIONS"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    sync_node_red_permissions
fi
