# shellcheck shell=bash
# Docker and prerequisite checks.
# shellcheck source=deploy/scripts/common/ports.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../common" && pwd)/ports.sh"

check_required_ports() {
    local ports=()
    local failed=0

    if [ "$WITH_SSL" = "true" ]; then
        ports=(80 443)
    else
        ports=("${FLEET_MANAGER_PORT:-7011}" "${ZITADEL_EXTERNALPORT:-9090}")
    fi

    if [ "$WITH_LOGGING" = "true" ]; then
        ports+=("${DOZZLE_PORT:-9999}")
    fi

    for port in "${ports[@]}"; do
        if check_port_available "$port"; then
            ok "Port $port available"
        else
            error "Port $port is already in use"
            failed=1
        fi
    done

    if [ "$failed" -eq 1 ]; then
        error "Free the ports above or change them in deploy/env/public.env, then retry"
        return 1
    fi
    return 0
}

docker_cli_exists() {
    [ -n "$(type -P docker)" ]
}

run_privileged() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    else
        sudo "$@"
    fi
}

require_install_privileges() {
    if [ "$(id -u)" -eq 0 ]; then
        info "Running as root — system packages can be installed directly."
        return 0
    fi

    if ! command -v sudo &>/dev/null; then
        error "Installing system dependencies requires root privileges, but 'sudo' is not available."
        error "Run './deploy/deploy-public.sh install' as root or install sudo first."
        return 1
    fi

    info "Administrator privileges are required to install system dependencies."
    sudo -v
    ok "Sudo access confirmed"
}

enable_sudo_docker_if_needed() {
    if check_docker; then
        return 0
    fi

    if [ "$(id -u)" -ne 0 ] && command -v sudo &>/dev/null && command sudo docker info >/dev/null 2>&1; then
        # shellcheck disable=SC2034 # Public compose wrapper reads this flag.
        USE_SUDO_DOCKER=true
        warn "Using sudo for Docker commands in this run because docker group access is not active yet."
        info "A new shell or re-login will restore normal docker-group access after installation."
        return 0
    fi

    return 1
}

wait_for_docker_daemon() {
    local timeout="${1:-120}"
    local elapsed=0

    while [ "$elapsed" -lt "$timeout" ]; do
        if docker_cli_exists && docker info >/dev/null 2>&1; then
            return 0
        fi
        sleep 3
        elapsed=$((elapsed + 3))
    done

    return 1
}

check_docker() {
    if ! docker_cli_exists; then
        return 1
    fi
    if ! docker info &>/dev/null 2>&1; then
        error "Docker is installed but not running or you lack permissions."
        error "Try: sudo systemctl start docker, open Docker Desktop, or run './deploy/deploy-public.sh install'"
        return 1
    fi
    return 0
}

check_compose() {
    docker_cli_exists || return 1
    if docker compose version &>/dev/null 2>&1; then
        return 0
    fi
    return 1
}

local_image_exists() {
    docker image inspect "$1" >/dev/null 2>&1
}

check_prereqs() {
    local missing=0

    if ! check_docker; then
        warn "Docker not found or not running"
        missing=1
    fi

    if ! check_compose; then
        warn "Docker Compose (v2) not found"
        missing=1
    fi

    for cmd in curl jq openssl; do
        if ! command -v "$cmd" &>/dev/null; then
            warn "Missing: $cmd"
            missing=1
        fi
    done

    return $missing
}

ensure_prereqs_for_up() {
    if check_prereqs; then
        return 0
    fi

    detect_os
    warn "Missing prerequisites detected. Running the install flow before deployment."
    if [ "$OS" = "linux" ]; then
        info "This may prompt for sudo so the script can install Docker, Docker Compose, curl, jq, and openssl."
    else
        info "On macOS this uses Homebrew and Docker Desktop and may trigger Homebrew or macOS permission prompts."
    fi
    AUTO_INSTALL_FROM_UP=true
    cmd_install
    # shellcheck disable=SC2034 # Public install flow reads this flag.
    AUTO_INSTALL_FROM_UP=false

    enable_sudo_docker_if_needed || true

    if check_prereqs; then
        return 0
    fi

    error "Prerequisites are still not ready."
    error "If Docker was just installed, you may need to start it or re-run './deploy/deploy-public.sh up' after your shell picks up new permissions."
    return 1
}
