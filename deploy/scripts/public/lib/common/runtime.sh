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

diagnose_run_failure() {
    # Docker Hub reports an exhausted pull quota as `toomanyrequests` inside the
    # output of whatever command triggered the pull. The caller only sees a
    # non-zero exit and names its own step — "Starting database containers
    # failed" — which reads as if the images themselves were broken. This is
    # the one place that still holds the captured output, so say what actually
    # happened here.
    local log_file="$1"

    if grep -qiE 'toomanyrequests|pull rate limit|429 Too Many Requests' "$log_file"; then
        warn "Docker Hub rate limit reached — the images are fine, the registry is throttling this IP."
        info "Raise the quota with 'docker login', or wait for the window to reset and re-run."
        info "Images already cached locally are reused untouched; only missing ones are fetched."
    fi
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
            diagnose_run_failure "$log_file"
        fi
    fi
    rm -f "$log_file"
    return "$status"
}
