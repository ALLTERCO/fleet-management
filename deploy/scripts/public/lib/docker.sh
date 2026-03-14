# lib/docker.sh — Docker installation, container helpers, OS/IP detection

detect_os() {
    local os="" distro="" arch=""

    case "$(uname -s)" in
        Linux)  os="linux" ;;
        Darwin) os="macos" ;;
        *)      error "Unsupported OS: $(uname -s)"; exit 1 ;;
    esac

    arch="$(uname -m)"
    case "$arch" in
        x86_64)  arch="amd64" ;;
        aarch64) arch="arm64" ;;
        arm64)   arch="arm64" ;;
        *)       error "Unsupported architecture: $arch"; exit 1 ;;
    esac

    if [ "$os" = "linux" ]; then
        if [ -f /etc/os-release ]; then
            # shellcheck source=/dev/null
            . /etc/os-release
            case "$ID" in
                ubuntu|debian|raspbian) distro="debian" ;;
                arch|manjaro)           distro="arch" ;;
                *)
                    if [ -n "${ID_LIKE:-}" ]; then
                        case "$ID_LIKE" in
                            *debian*|*ubuntu*) distro="debian" ;;
                            *arch*)            distro="arch" ;;
                        esac
                    fi
                    ;;
            esac
        fi
        if [ -z "$distro" ]; then
            error "Unsupported Linux distribution. Supported: Ubuntu, Debian, Raspberry Pi OS (arm64), Arch Linux"
            exit 1
        fi
        # Raspberry Pi detection
        if [ "$arch" = "arm64" ] && [ "$distro" = "debian" ]; then
            info "Detected Raspberry Pi (arm64)"
        fi
    fi

    OS="$os"
    DISTRO="$distro"
    ARCH="$arch"
}

detect_all_ips() {
    # Returns all non-loopback, non-virtual IPv4 addresses, one per line.
    # Excludes Docker bridge interfaces (docker0, br-*, veth*).
    # Works on: Debian/Ubuntu, Arch, Raspberry Pi, macOS.
    local ips=""

    # Linux: ip addr — exclude Docker/container virtual interfaces
    if command -v ip &>/dev/null; then
        ips=$(ip -4 addr show scope global 2>/dev/null \
            | awk '/^[0-9]+:/ { iface=$2 } /inet / { print iface, $2 }' \
            | grep -vE '^(docker[0-9]*|br-|veth)' \
            | awk '{sub(/\/.*/, "", $2); print $2}' \
            | sort -u || true)
    fi

    # macOS / fallback: ifconfig (no Docker bridge interfaces on macOS)
    if [ -z "$ips" ] && command -v ifconfig &>/dev/null; then
        ips=$(ifconfig 2>/dev/null \
            | grep 'inet ' | grep -v '127.0.0.1' \
            | awk '{print $2}' | sort -u || true)
    fi

    echo "$ips"
}

detect_ip() {
    local ip=""

    # Method 1: ip route (Linux) — picks the IP used for outbound traffic
    if command -v ip &>/dev/null; then
        ip=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -1 2>/dev/null || true)
    fi

    # Method 2: hostname -I (Linux fallback)
    if [ -z "$ip" ] && command -v hostname &>/dev/null; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    fi

    # Method 3: ifconfig (macOS)
    if [ -z "$ip" ] && command -v ifconfig &>/dev/null; then
        ip=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -1 || true)
    fi

    # Method 4: route + awk (macOS fallback)
    if [ -z "$ip" ] && command -v route &>/dev/null; then
        local iface
        iface=$(route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}' || true)
        if [ -n "$iface" ]; then
            ip=$(ifconfig "$iface" 2>/dev/null | grep 'inet ' | awk '{print $2}' || true)
        fi
    fi

    echo "${ip:-localhost}"
}

check_port_available() {
    # Portable port check: works on Debian, Ubuntu, Arch, Raspberry Pi, macOS.
    # Returns 0 if port is free, 1 if in use.
    local port="$1"

    # Method 1: ss (Linux — Debian, Ubuntu, Arch, RPi; not on macOS)
    if command -v ss &>/dev/null; then
        if ss -tlnH 2>/dev/null | awk '{print $4}' | grep -qE "(:|^)${port}$"; then
            return 1
        fi
        return 0
    fi

    # Method 2: lsof (macOS, some Linux)
    if command -v lsof &>/dev/null; then
        if lsof -iTCP:"$port" -sTCP:LISTEN -P -n &>/dev/null 2>&1; then
            return 1
        fi
        return 0
    fi

    # Method 3: /dev/tcp probe (bash built-in, works everywhere bash does)
    if (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null; then
        return 1
    fi

    return 0
}

check_required_ports() {
    # Check all ports the stack will bind. Called before starting services.
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

container_name() {
    printf '%s-%s-1' "$COMPOSE_PROJECT_NAME" "$1"
}

container_health_status() {
    local container="$1"
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo "missing"
}

container_exists() {
    local container="$1"
    docker ps -a --filter "name=^${container}$" --format '{{.Names}}' 2>/dev/null | grep -qx "$container"
}

cleanup_orphan_optional_containers() {
    local orphans=()
    local service
    local container

    for service in traefik mdns; do
        container="$(container_name "$service")"
        if ! container_exists "$container"; then
            continue
        fi

        case "$service" in
            traefik)
                [ "$WITH_SSL" = "true" ] && continue
                ;;
            mdns)
                [ "$WITH_MDNS" = "true" ] && continue
                ;;
        esac

        orphans+=("$container")
    done

    [ ${#orphans[@]} -gt 0 ] || return 0

    warn "Detected stack containers from an older topology: ${orphans[*]}"
    info "Removing orphaned optional containers that are not part of the current configuration..."
    if ! docker rm -f "${orphans[@]}" >/dev/null 2>&1; then
        warn "Failed to remove one or more orphaned optional containers"
        return 1
    fi
    ok "Removed orphaned optional containers: ${orphans[*]}"
}

wait_for_container_health() {
    local service="$1"
    local timeout="${2:-120}"
    local container
    container="$(container_name "$service")"

    local elapsed=0
    local health_status=""
    while [ "$elapsed" -lt "$timeout" ]; do
        health_status="$(container_health_status "$container")"
        case "$health_status" in
            healthy|running)
                if [ -n "$SPINNER_PID" ]; then
                    spinner_update "Waiting for services to become healthy... (${service} ready ${elapsed}s)"
                else
                    ok "${service} is ready (${elapsed}s)"
                fi
                return 0
                ;;
            unhealthy)
                if [ -n "$SPINNER_PID" ]; then
                    spinner_update "Waiting for services to become healthy... (${service} unhealthy ${elapsed}s)"
                else
                    warn "${service} healthcheck is reporting unhealthy (${elapsed}s)"
                fi
                ;;
            *)
                if [ -n "$SPINNER_PID" ]; then
                    spinner_update "Waiting for services to become healthy... (${service} ${health_status} ${elapsed}s)"
                fi
                ;;
        esac
        sleep 3
        elapsed=$((elapsed + 3))
    done

    return 1
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
    AUTO_INSTALL_FROM_UP=false

    enable_sudo_docker_if_needed || true

    if check_prereqs; then
        return 0
    fi

    error "Prerequisites are still not ready."
    error "If Docker was just installed, you may need to start it or re-run './deploy/deploy-public.sh up' after your shell picks up new permissions."
    return 1
}

