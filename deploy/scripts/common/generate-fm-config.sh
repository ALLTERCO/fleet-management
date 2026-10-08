#!/usr/bin/env bash
#
# Generate Fleet Manager config for dev mode or Zitadel OIDC mode.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
CONFIG_LIB_DIR="$SCRIPT_DIR/generate-fm-config"

# shellcheck source=deploy/scripts/common/generate-fm-config/oidc.sh
source "$CONFIG_LIB_DIR/oidc.sh"
# shellcheck source=deploy/scripts/common/nodered-runtime-env.sh
source "$SCRIPT_DIR/nodered-runtime-env.sh"

write_generated_json() {
    local output_file="$1"
    local output_dir tmp_file old_umask
    output_dir="$(dirname "$output_file")"
    mkdir -p "$output_dir"

    old_umask="$(umask)"
    umask 077
    tmp_file="$(mktemp "${output_file}.XXXXXX")" || {
        umask "$old_umask"
        return 1
    }
    umask "$old_umask"

    if ! cat > "$tmp_file"; then
        rm -f "$tmp_file"
        return 1
    fi
    if ! jq empty "$tmp_file" >/dev/null 2>&1; then
        echo "ERROR: Generated JSON is invalid: $output_file" >&2
        rm -f "$tmp_file"
        return 1
    fi

    chmod 0600 "$tmp_file"
    mv "$tmp_file" "$output_file"
}

write_generated_env() {
    local output_file="$1"
    local output_dir tmp_file old_umask
    output_dir="$(dirname "$output_file")"
    mkdir -p "$output_dir"

    old_umask="$(umask)"
    umask 077
    tmp_file="$(mktemp "${output_file}.XXXXXX")" || {
        umask "$old_umask"
        return 1
    }
    umask "$old_umask"

    if ! cat > "$tmp_file"; then
        rm -f "$tmp_file"
        return 1
    fi
    if ! awk '
        /^#/ || /^[[:space:]]*$/ { next }
        !/^[A-Za-z_][A-Za-z0-9_-]*=/ { exit 1 }
    ' "$tmp_file"; then
        echo "ERROR: Generated env file is invalid: $output_file" >&2
        rm -f "$tmp_file"
        return 1
    fi

    chmod 0600 "$tmp_file"
    mv "$tmp_file" "$output_file"
}

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
    zitadel)
        generate_zitadel_config "$TARGET" "$CLIENT_ID"
        ;;
    "")
        echo "ERROR: --mode is required (zitadel)" >&2
        exit 1
        ;;
    *)
        echo "ERROR: Unknown mode '$MODE' (expected: zitadel)" >&2
        exit 1
        ;;
esac
