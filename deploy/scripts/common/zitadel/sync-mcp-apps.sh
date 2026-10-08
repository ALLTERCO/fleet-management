#!/usr/bin/env bash
# Registers the MCP sign-in apps on an existing install without a full
# bootstrap and records their client ids in the state file. Private update
# and public upgrade run it before the Fleet container is replaced, so an
# install bootstrapped before browser sign-in existed gets it on update.
#
# Env: ZITADEL_URL, MACHINEKEY_PATH, STATE_FILE (required), ZITADEL_HOST_HEADER,
#      FM_MCP_OAUTH_LEVELS, FM_MCP_OAUTH_EXTRA_REDIRECT_URIS (optional).

set -euo pipefail

ZITADEL_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=deploy/scripts/common/zitadel-lib.sh
source "$ZITADEL_SCRIPTS_DIR/../zitadel-lib.sh"
# shellcheck source=deploy/scripts/common/zitadel/policies.sh
source "$ZITADEL_SCRIPTS_DIR/policies.sh"
# shellcheck source=deploy/scripts/common/zitadel/users.sh
source "$ZITADEL_SCRIPTS_DIR/users.sh"
# shellcheck source=deploy/scripts/common/zitadel/apps.sh
source "$ZITADEL_SCRIPTS_DIR/apps.sh"
# shellcheck source=deploy/scripts/common/zitadel/state.sh
source "$ZITADEL_SCRIPTS_DIR/state.sh"

validate_mcp_project_state() {
    if ! awk -F= '
        $1 == "ZITADEL_CLIENT_PROJECT_ID" || $1 == "ZITADEL_PROJECT_NAME" {
            count[$1]++
            if (substr($0, index($0, "=") + 1) !~ /[^[:space:]]/) invalid = 1
        }
        END {
            exit (invalid || count["ZITADEL_CLIENT_PROJECT_ID"] != 1 || count["ZITADEL_PROJECT_NAME"] != 1)
        }
    ' "$STATE_FILE"; then
        echo "ERROR: State needs exactly one nonblank Fleet project id and name" >&2
        return 1
    fi
}

sync_mcp_apps() {
    ZITADEL_URL="${ZITADEL_URL:?ZITADEL_URL is required}"
    MACHINEKEY_PATH="${MACHINEKEY_PATH:?MACHINEKEY_PATH is required}"
    STATE_FILE="${STATE_FILE:?STATE_FILE is required}"
    [ -f "$STATE_FILE" ] || { echo "ERROR: State file not found: $STATE_FILE" >&2; return 1; }
    validate_mcp_project_state || return 1

    PROJECT_ID="$(state_var ZITADEL_CLIENT_PROJECT_ID)"
    local project_name
    project_name="$(state_var ZITADEL_PROJECT_NAME)"
    if [ -z "$PROJECT_ID" ] || [ -z "$project_name" ]; then
        echo "ERROR: $STATE_FILE has no Fleet project; run the full Zitadel bootstrap" >&2
        return 1
    fi
    MCP_APP_NAME_PREFIX="$(mcp_app_name_prefix "$project_name")"

    if ! TOKEN=$(zitadel_get_token "$MACHINEKEY_PATH" "$ZITADEL_URL" 2>/dev/null); then
        echo "ERROR: Could not authenticate with the first-instance machinekey" >&2
        return 1
    fi
    ensure_mcp_apps
    save_state_value FM_MCP_OAUTH_CLIENT_IDS "$FM_MCP_OAUTH_CLIENT_IDS"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    sync_mcp_apps
fi
