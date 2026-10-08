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

# A registry refusal is one line inside the Compose dump under a step label
# that names the containers, so operators read it as broken images.
diagnose_run_failure() {
    local log_file="$1"
    local ref

    if grep -qiE 'toomanyrequests|pull rate limit|Too Many Requests' "$log_file"; then
        warn "Docker Hub pull rate limit reached. The images are fine; the registry is throttling this IP."
        info "Run 'docker login' for a higher quota, or wait for the 6-hour window to reset and re-run."
        info "Images already cached locally are reused; only missing ones are fetched."
        return 0
    fi

    ref="$(sed -nE 's/.*manifest for ([^[:space:]]+) not found.*/\1/p' "$log_file" | head -n 1)"
    if [ -n "$ref" ] || grep -qiE 'manifest unknown|no such manifest' "$log_file"; then
        warn "Image tag does not exist: ${ref:-see the output above}"
        info "Check the *_VERSION values in ${VERSIONS_FILE:-deploy/VERSIONS.env} (FM_VERSION picks the Fleet Manager tag)."
        case "$ref" in
            "${DOCKER_HUB_IMAGE:-shellygroup/fleet-management}":*)
                info "Published tags: https://hub.docker.com/r/${DOCKER_HUB_IMAGE:-shellygroup/fleet-management}/tags" ;;
        esac
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
