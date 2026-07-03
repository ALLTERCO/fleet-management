# shellcheck shell=bash
# common/runtime.sh — Docker wrapper and quiet/debug execution.
# shellcheck disable=SC2034 # Shared globals are consumed after this file is sourced.

FM_SCRIPT_VERSION="2.0.0"

AUTO_INSTALL_FROM_UP="${AUTO_INSTALL_FROM_UP:-false}"
USE_SUDO_DOCKER="${USE_SUDO_DOCKER:-false}"
DEBUG_MODE="${DEBUG_MODE:-false}"
PARSED_GLOBAL_ARGS=()

docker() {
    local docker_bin
    docker_bin="$(type -P docker || true)"
    if [ -z "$docker_bin" ]; then
        error "Docker CLI not found"
        return 127
    fi

    if [ "$USE_SUDO_DOCKER" = "true" ]; then
        command sudo "$docker_bin" "$@"
    else
        command "$docker_bin" "$@"
    fi
}

enable_debug_mode() {
    if [ "$DEBUG_MODE" != "true" ]; then
        return 0
    fi

    export PS4='+ [deploy-public:${LINENO}] '
    info "Debug mode enabled — shell commands will be traced."
    set -x
}

run_quiet() {
    local label="$1"
    shift

    if [ "$DEBUG_MODE" = "true" ]; then
        "$@"
        return $?
    fi

    local log_file
    log_file=$(mktemp "${TMPDIR:-/tmp}/deploy-public.XXXXXX")

    local status=0
    "$@" >"$log_file" 2>&1 || status=$?

    if [ "$status" -ne 0 ]; then
        [ -n "$label" ] && error "$label failed"
        if [ -s "$log_file" ]; then
            sed 's/^/    /' "$log_file" >&2
        fi
    fi
    rm -f "$log_file"
    return "$status"
}
