#!/usr/bin/env bash
#
# Generate Fleet Manager config for dev mode or Zitadel OIDC mode.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
CONFIG_LIB_DIR="$SCRIPT_DIR/generate-fm-config"

# shellcheck source=deploy/scripts/common/generate-fm-config/dev.sh
source "$CONFIG_LIB_DIR/dev.sh"
# shellcheck source=deploy/scripts/common/generate-fm-config/oidc.sh
source "$CONFIG_LIB_DIR/oidc.sh"

config_arg_value() {
    local flag="$1"
    local value="${2-}"
    if [ -z "$value" ] || [[ "$value" == --* ]]; then
        echo "ERROR: $flag requires a value" >&2
        exit 1
    fi
    printf '%s' "$value"
}

MODE=""
TARGET="docker"
CLIENT_ID=""

while [ $# -gt 0 ]; do
    case "$1" in
        --mode)
            MODE="$(config_arg_value "$1" "${2-}")"
            shift 2
            ;;
        --target)
            TARGET="$(config_arg_value "$1" "${2-}")"
            shift 2
            ;;
        --client)
            CLIENT_ID="$(config_arg_value "$1" "${2-}")"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

case "$MODE" in
    dev)
        generate_dev_config
        ;;
    zitadel)
        generate_zitadel_config "$TARGET" "$CLIENT_ID"
        ;;
    "")
        echo "ERROR: --mode is required (zitadel or dev)" >&2
        exit 1
        ;;
    *)
        echo "ERROR: Unknown mode '$MODE' (expected: zitadel or dev)" >&2
        exit 1
        ;;
esac
