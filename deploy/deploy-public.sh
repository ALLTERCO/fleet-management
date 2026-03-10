#!/usr/bin/env bash
#
# deploy-public.sh — Fleet Management Installer
#
# Fully self-contained installer for the open-source Fleet Management system.
# Downloads and runs Fleet Manager, TimescaleDB, and Zitadel (OIDC auth).
#
# Supports: Ubuntu/Debian, Raspberry Pi (arm64), Arch Linux, macOS
#
# Usage:
#   ./deploy-public.sh install        Install Docker + Docker Compose (if needed)
#   ./deploy-public.sh up             Start Fleet Management
#   ./deploy-public.sh down           Stop Fleet Management
#   ./deploy-public.sh status         Show service status
#   ./deploy-public.sh logs [service] Show logs (fleet-manager, zitadel, fleet-db)
#   ./deploy-public.sh update         Pull latest images and restart
#   ./deploy-public.sh ip             Show machine IP and access URLs
#   ./deploy-public.sh help           Show this help
#
# Environment overrides (set before running):
#   FM_VERSION           Fleet Manager version (default: latest)
#   FLEET_MANAGER_PORT   FM port (default: 7011)
#   ZITADEL_EXTERNALPORT Zitadel port (default: 9090)
#   POSTGRES_PASSWORD    TimescaleDB password (default: auto-generated)

set -euo pipefail

# ── Version ───────────────────────────────────────────────────
FM_SCRIPT_VERSION="2.0.0"

# ── Colors ────────────────────────────────────────────────────
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null)" -ge 8 ]; then
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    BLUE=$(tput setaf 4)
    CYAN=$(tput setaf 6)
    BOLD=$(tput bold)
    RESET=$(tput sgr0)
else
    RED="" GREEN="" YELLOW="" BLUE="" CYAN="" BOLD="" RESET=""
fi

# ── Logging ───────────────────────────────────────────────────
info()  { echo "${GREEN}[INFO]${RESET}  $*"; }
warn()  { echo "${YELLOW}[WARN]${RESET}  $*"; }
error() { echo "${RED}[ERROR]${RESET} $*" >&2; }
step()  { echo ""; echo "${BOLD}${BLUE}==> $*${RESET}"; }
ok()    { echo "${GREEN}  OK${RESET} $*"; }

# ── Constants ─────────────────────────────────────────────────
FM_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$FM_DIR/deploy"
STATE_DIR="$DEPLOY_DIR/state"
COMPOSE_DIR="$DEPLOY_DIR/compose"
VERSIONS_FILE="$DEPLOY_DIR/VERSIONS.env"

# Docker Hub image
DOCKER_HUB_IMAGE="shellygroup/fleet-management"

# ── Load defaults from public.env ─────────────────────────────
# public.env provides pre-configured demo credentials and sensible defaults.
# Environment variables set before running this script take precedence.
PUBLIC_ENV_FILE="$DEPLOY_DIR/env/public.env"
if [ -f "$PUBLIC_ENV_FILE" ]; then
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | xargs)
        if [ -z "${!key:-}" ]; then
            export "$key=$value"
        fi
    done < "$PUBLIC_ENV_FILE"
fi

# ── Defaults (fallbacks if public.env is missing) ─────────────
: "${FM_VERSION:=latest}"
: "${FLEET_MANAGER_PORT:=7011}"
: "${ZITADEL_EXTERNALPORT:=9090}"
: "${COMPOSE_PROJECT_NAME:=fm}"

# ── OS Detection ──────────────────────────────────────────────
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

# ── IP Detection ──────────────────────────────────────────────
detect_ip() {
    local ip=""

    # Method 1: ip route (Linux)
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

# ── Prerequisite Checks ──────────────────────────────────────
check_docker() {
    if ! command -v docker &>/dev/null; then
        return 1
    fi
    if ! docker info &>/dev/null 2>&1; then
        error "Docker is installed but not running or you lack permissions."
        error "Try: sudo systemctl start docker && sudo usermod -aG docker \$USER"
        return 1
    fi
    return 0
}

check_compose() {
    if docker compose version &>/dev/null 2>&1; then
        return 0
    fi
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

# ── Install Docker + Dependencies ─────────────────────────────
cmd_install() {
    step "Installing Docker and dependencies"
    detect_os

    info "OS: $OS | Distro: ${DISTRO:-n/a} | Arch: $ARCH"

    case "$OS" in
        linux)
            case "$DISTRO" in
                debian) install_debian ;;
                arch)   install_arch ;;
            esac
            ;;
        macos)
            install_macos
            ;;
    esac

    # Verify installation
    step "Verifying installation"
    if check_docker && check_compose; then
        ok "Docker $(docker --version | sed 's/[^0-9]*\([0-9][0-9.]*\).*/\1/')"
        ok "Docker Compose $(docker compose version --short 2>/dev/null)"
        for cmd in curl jq openssl; do
            command -v "$cmd" &>/dev/null && ok "$cmd"
        done
        echo ""
        info "Installation complete. You can now run: ${BOLD}./deploy-public.sh up${RESET}"
    else
        error "Installation verification failed. Please check the errors above."
        exit 1
    fi
}

install_debian() {
    info "Installing for Debian/Ubuntu..."

    # Dependencies
    sudo apt-get update -qq
    sudo apt-get install -y -qq ca-certificates curl gnupg jq openssl lsb-release >/dev/null

    if ! check_docker; then
        info "Installing Docker..."
        # Add Docker GPG key
        sudo install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg \
            | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
        sudo chmod a+r /etc/apt/keyrings/docker.gpg

        # Add Docker repo
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
            https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
            $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
            | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        sudo apt-get update -qq
        sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null

        # Start Docker
        sudo systemctl enable --now docker

        # Add current user to docker group
        if ! groups "$USER" | grep -q docker; then
            sudo usermod -aG docker "$USER"
            warn "Added $USER to docker group. You may need to log out and back in."
        fi
    else
        ok "Docker already installed"
    fi
}

install_arch() {
    info "Installing for Arch Linux..."

    sudo pacman -Sy --needed --noconfirm docker docker-compose curl jq openssl >/dev/null

    if ! systemctl is-active --quiet docker; then
        sudo systemctl enable --now docker
    fi

    if ! groups "$USER" | grep -q docker; then
        sudo usermod -aG docker "$USER"
        warn "Added $USER to docker group. You may need to log out and back in."
    fi
}

install_macos() {
    info "Installing for macOS..."

    if ! command -v brew &>/dev/null; then
        error "Homebrew not found. Install it first: https://brew.sh"
        exit 1
    fi

    # Install deps
    for pkg in jq openssl curl; do
        if ! command -v "$pkg" &>/dev/null; then
            brew install "$pkg"
        fi
    done

    if ! check_docker; then
        info "Installing Docker Desktop..."
        brew install --cask docker
        echo ""
        warn "Docker Desktop installed. Please:"
        warn "  1. Open Docker Desktop from Applications"
        warn "  2. Complete the setup wizard"
        warn "  3. Wait for Docker to start (whale icon in menu bar)"
        warn "  4. Then run: ./deploy-public.sh up"
        exit 0
    else
        ok "Docker already installed"
    fi
}

# ── State Generation ──────────────────────────────────────────
generate_passwords() {
    # Use values from public.env (loaded above) or generate if not set.
    # On first run: public.env demo values are used for simplicity.
    # Users can override by setting env vars before running.
    : "${POSTGRES_PASSWORD:=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)}"
    : "${ZITADEL_POSTGRES_PASSWORD:=$POSTGRES_PASSWORD}"
    : "${ZITADEL_DB_USER_PASSWORD:=$POSTGRES_PASSWORD}"
    : "${ZITADEL_ADMIN_PASSWORD:=FleetDemo1234!}"
    : "${ZITADEL_MASTERKEY:=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)}"

    export POSTGRES_PASSWORD ZITADEL_POSTGRES_PASSWORD ZITADEL_DB_USER_PASSWORD
    export ZITADEL_ADMIN_PASSWORD ZITADEL_MASTERKEY
}

save_env() {
    # Save passwords to state so they persist across restarts
    local env_file="$STATE_DIR/.env"
    mkdir -p "$STATE_DIR"

    if [ -f "$env_file" ]; then
        # Re-load existing passwords
        # shellcheck source=/dev/null
        source "$env_file"
        export POSTGRES_PASSWORD ZITADEL_POSTGRES_PASSWORD ZITADEL_DB_USER_PASSWORD
        export ZITADEL_ADMIN_PASSWORD ZITADEL_MASTERKEY
        info "Loaded existing configuration"
    else
        cat > "$env_file" <<EOF
# Auto-generated by deploy-public.sh — do not edit
# Delete this file + volumes to reset: ./deploy-public.sh down --volumes
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
ZITADEL_POSTGRES_PASSWORD=${ZITADEL_POSTGRES_PASSWORD}
ZITADEL_DB_USER_PASSWORD=${ZITADEL_DB_USER_PASSWORD}
ZITADEL_ADMIN_PASSWORD=${ZITADEL_ADMIN_PASSWORD}
ZITADEL_MASTERKEY=${ZITADEL_MASTERKEY}
EOF
        chmod 0600 "$env_file"
        info "Generated new configuration"
    fi
}

generate_init_sql() {
    mkdir -p "$STATE_DIR"

    # Fleet DB init SQL
    cat > "$STATE_DIR/init-fleet-db.sql" <<'SQL'
-- Auto-generated by deploy-public.sh
CREATE SCHEMA IF NOT EXISTS migration;
SQL

    # Zitadel DB init SQL
    local escaped_pw="${ZITADEL_DB_USER_PASSWORD//\'/\'\'}"
    cat > "$STATE_DIR/init-zitadel-db.sql" <<SQL
-- Auto-generated by deploy-public.sh
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'zitadel') THEN
    CREATE USER zitadel WITH PASSWORD '${escaped_pw}';
  ELSE
    ALTER USER zitadel WITH PASSWORD '${escaped_pw}';
  END IF;
END
\$\$;
GRANT ALL PRIVILEGES ON DATABASE zitadel TO zitadel;
ALTER USER zitadel CREATEDB;
SQL

    chmod 0644 "$STATE_DIR/init-fleet-db.sql" "$STATE_DIR/init-zitadel-db.sql"
}

apply_retention_policies() {
    # Apply configurable retention policies to TimescaleDB hypertables.
    # Safe to run repeatedly — removes old policies before adding new ones.
    # Runs after DB is healthy and migrations have created the tables.

    local status_retention="${STATUS_RETENTION:-7 days}"
    local em_retention="${EM_STATS_RETENTION:-1 year}"
    local audit_retention="${AUDIT_LOG_RETENTION:-90 days}"

    info "Applying retention policies: status=${status_retention}, em=${em_retention}, audit=${audit_retention}"

    local sql
    sql=$(cat <<SQL
-- Auto-applied by deploy-public.sh
-- Idempotent: removes existing policies before re-adding

-- device.status — high-frequency telemetry (default: 24 hours)
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='device' AND table_name='status') THEN
    PERFORM remove_retention_policy('device.status', if_exists => true);
    PERFORM add_retention_policy('device.status', INTERVAL '${status_retention}');
    PERFORM remove_compression_policy('device.status', if_exists => true);
    PERFORM add_compression_policy('device.status', compress_created_before => INTERVAL '1 hour');
  END IF;
END \$\$;

-- device_em.stats — energy meter data (default: 1 year)
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='device_em' AND table_name='stats') THEN
    PERFORM remove_retention_policy('device_em.stats', if_exists => true);
    PERFORM add_retention_policy('device_em.stats', INTERVAL '${em_retention}');
    PERFORM remove_compression_policy('device_em.stats', if_exists => true);
    PERFORM add_compression_policy('device_em.stats', compress_created_before => INTERVAL '24 hours');
  END IF;
END \$\$;

-- logging.audit_log — user actions and RPC calls (default: 90 days)
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='logging' AND table_name='audit_log') THEN
    -- Ensure it's a hypertable (migration may not have set retention)
    PERFORM remove_retention_policy('logging.audit_log', if_exists => true);
    PERFORM add_retention_policy('logging.audit_log', INTERVAL '${audit_retention}');
  END IF;
END \$\$;
SQL
)

    # Execute via docker exec against the running fleet-db
    if echo "$sql" | docker exec -i "${COMPOSE_PROJECT_NAME}-fleet-db-1" \
        psql -U postgres -d fleet --no-psqlrc -q 2>/dev/null; then
        ok "Retention policies applied"
    else
        info "Retention policies will be applied after first restart (tables created during initial startup)"
    fi
}

generate_system_api_keypair() {
    local sa_dir="$STATE_DIR/system-api"
    mkdir -p "$sa_dir"
    chmod 0755 "$sa_dir"

    if [ -f "$sa_dir/system-user.pem" ] && [ -f "$sa_dir/system-user.pub" ]; then
        ok "System API keypair exists"
    else
        info "Generating RSA keypair for System API..."
        openssl genrsa -traditional -out "$sa_dir/system-user.pem" 2048 2>/dev/null
        openssl rsa -in "$sa_dir/system-user.pem" -outform PEM -pubout -out "$sa_dir/system-user.pub" 2>/dev/null
        chmod 0600 "$sa_dir/system-user.pem"
        ok "Keypair generated"
    fi

    # Always regenerate config
    cat > "$sa_dir/system-api-config.yaml" <<'EOF'
# Auto-generated by deploy-public.sh
SystemAPIUsers:
  system-user-1:
    Path: /system-api/system-user.pub
EOF
    chmod 0644 "$sa_dir/system-api-config.yaml" "$sa_dir/system-user.pub"
}

generate_selfsigned_cert() {
    local hostname="$1"
    local tls_dir="$STATE_DIR/tls"
    local dyn_dir="$tls_dir/dynamic"
    mkdir -p "$dyn_dir"

    if [ -f "$tls_dir/server.crt" ] && [ -f "$tls_dir/server.key" ]; then
        ok "Self-signed TLS certificate exists"
        return 0
    fi

    info "Generating self-signed TLS certificate for: $hostname"

    # Build Subject Alternative Names (support both IP and DNS)
    local san="DNS:localhost"
    if echo "$hostname" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        san="${san},IP:${hostname},IP:127.0.0.1"
    else
        san="${san},DNS:${hostname}"
    fi

    # Generate CA key + cert
    openssl genrsa -out "$tls_dir/ca.key" 2048 2>/dev/null
    openssl req -x509 -new -nodes \
        -key "$tls_dir/ca.key" \
        -sha256 -days 3650 \
        -subj "/CN=Fleet Manager Local CA" \
        -out "$tls_dir/ca.crt" 2>/dev/null

    # Generate server key + CSR
    openssl genrsa -out "$tls_dir/server.key" 2048 2>/dev/null
    openssl req -new \
        -key "$tls_dir/server.key" \
        -subj "/CN=${hostname}" \
        -out "$tls_dir/server.csr" 2>/dev/null

    # Sign with CA, including SANs
    openssl x509 -req \
        -in "$tls_dir/server.csr" \
        -CA "$tls_dir/ca.crt" \
        -CAkey "$tls_dir/ca.key" \
        -CAcreateserial \
        -out "$tls_dir/server.crt" \
        -days 3650 -sha256 \
        -extfile <(echo "subjectAltName=${san}") 2>/dev/null

    rm -f "$tls_dir/server.csr"
    chmod 0600 "$tls_dir/ca.key" "$tls_dir/server.key"
    chmod 0644 "$tls_dir/ca.crt" "$tls_dir/server.crt"

    ok "Certificate generated (valid 10 years, SAN: ${san})"

    # Generate Traefik dynamic TLS config
    cat > "$dyn_dir/tls.yml" <<'EOF'
tls:
  certificates:
    - certFile: /etc/traefik/certs/server.crt
      keyFile: /etc/traefik/certs/server.key
  stores:
    default:
      defaultCertificate:
        certFile: /etc/traefik/certs/server.crt
        keyFile: /etc/traefik/certs/server.key
EOF
    chmod 0644 "$dyn_dir/tls.yml"
    ok "Traefik TLS config written"

    echo ""
    info "To trust this certificate on clients, install the CA:"
    info "  ${CYAN}${tls_dir}/ca.crt${RESET}"
}

# ── Pre-flight Image Verification ─────────────────────────────
verify_images() {
    # Check that pinned image versions actually exist before pulling.
    # Catches typos / unreleased versions early with a clear message.
    # Skip with FM_SKIP_IMAGE_VERIFY=true (e.g. CI testing with local images).
    if [ "${FM_SKIP_IMAGE_VERIFY:-}" = "true" ]; then
        info "Skipping remote image verification (FM_SKIP_IMAGE_VERIFY=true)"
        return 0
    fi

    local images=()
    local versions_file="$VERSIONS_FILE"

    if [ -f "$versions_file" ]; then
        # shellcheck source=/dev/null
        source "$versions_file"
    fi

    images=(
        "timescale/timescaledb:${TIMESCALEDB_VERSION:-latest}"
        "postgres:${ZITADEL_POSTGRES_VERSION:-latest}"
        "ghcr.io/zitadel/zitadel:${ZITADEL_VERSION:-latest}"
        "${DOCKER_HUB_IMAGE}:${FM_VERSION:-latest}"
    )

    # Add Traefik if SSL enabled
    if [ "$WITH_SSL" = "true" ]; then
        images+=("traefik:${TRAEFIK_VERSION:-latest}")
    fi

    local failed=0
    for img in "${images[@]}"; do
        if docker manifest inspect "$img" >/dev/null 2>&1; then
            ok "$img"
        else
            error "Image not found: $img"
            failed=1
        fi
    done

    if [ $failed -eq 1 ]; then
        echo ""
        error "Some Docker images could not be found. Check deploy/VERSIONS.env for typos."
        error "Run './deploy-public.sh doctor' for full diagnostics."
        exit 1
    fi
}

# ── Addon flags (set by cmd_up, persisted in deploy-meta) ─────
WITH_MDNS="${WITH_MDNS:-false}"
WITH_SSL="${WITH_SSL:-false}"
SSL_MODE=""  # "letsencrypt" or "selfsigned"
SSL_DOMAIN=""
SSL_EMAIL=""

# ── Compose Command Builder ──────────────────────────────────
compose_cmd() {
    local env_args=()
    local compose_files=()

    # Load VERSIONS.env
    if [ -f "$VERSIONS_FILE" ]; then
        env_args+=(--env-file "$VERSIONS_FILE")
    fi

    # public.env values are already loaded into shell env (lines 65-75).
    # Shell env is used by Docker Compose for YAML substitution,
    # so we don't pass --env-file here — avoids precedence conflicts
    # when callers override vars (e.g., FLEET_MANAGER_PORT=7012 in CI).

    # Load saved state env
    if [ -f "$STATE_DIR/.env" ]; then
        env_args+=(--env-file "$STATE_DIR/.env")
    fi

    # Load OIDC config if available
    if [ -f "$STATE_DIR/fm-oidc.env" ]; then
        env_args+=(--env-file "$STATE_DIR/fm-oidc.env")
    fi

    # Core compose files (always included)
    compose_files=(
        -f "$COMPOSE_DIR/docker-compose.yml"
        -f "$COMPOSE_DIR/docker-compose.zitadel.yml"
        -f "$COMPOSE_DIR/docker-compose.fleet-image.yml"
        -f "$COMPOSE_DIR/docker-compose.selfhosted.yml"
    )

    # Zitadel port publication: only when NOT behind Traefik (SSL)
    if [ "$WITH_SSL" != "true" ]; then
        compose_files+=(-f "$COMPOSE_DIR/docker-compose.zitadel-ports.yml")
    fi

    # Optional: mDNS repeater
    if [ "$WITH_MDNS" = "true" ] && [ -f "$COMPOSE_DIR/docker-compose.mdns.yml" ]; then
        # Auto-detect network interface if not set in env
        if [ -z "${MDNS_ON:-}" ] || [ "$MDNS_ON" = "eth0" ]; then
            MDNS_ON=$(ip route | grep default | awk '{print $5}' | head -1)
            export MDNS_ON
            log "Auto-detected MDNS_ON=$MDNS_ON (default route interface)"
        fi
        if [ -z "${MDNS_TO:-}" ] || [ "$MDNS_TO" = "br-fleet-public" ]; then
            MDNS_TO="br-${COMPOSE_PROJECT_NAME:-fleet-public}"
            export MDNS_TO
            log "Auto-detected MDNS_TO=$MDNS_TO (Docker bridge network)"
        fi
        compose_files+=(-f "$COMPOSE_DIR/docker-compose.mdns.yml")
    fi

    # Optional: Traefik with SSL
    if [ "$WITH_SSL" = "true" ]; then
        if [ "$SSL_MODE" = "selfsigned" ] && [ -f "$COMPOSE_DIR/docker-compose.traefik-selfsigned.yml" ]; then
            compose_files+=(-f "$COMPOSE_DIR/docker-compose.traefik-selfsigned.yml")
        elif [ -f "$COMPOSE_DIR/docker-compose.traefik-public.yml" ]; then
            compose_files+=(-f "$COMPOSE_DIR/docker-compose.traefik-public.yml")
        fi
    fi

    # Log loaded compose files
    local file_names=""
    for arg in "${compose_files[@]}"; do
        [ "$arg" = "-f" ] && continue
        file_names="${file_names:+$file_names, }$(basename "$arg")"
    done
    info "Compose files: ${file_names}"

    docker compose \
        -p "$COMPOSE_PROJECT_NAME" \
        "${env_args[@]}" \
        "${compose_files[@]}" \
        "$@"
}

# ── Wait for Zitadel ─────────────────────────────────────────
wait_for_zitadel() {
    local url="$1"
    local timeout="${2:-180}"
    local elapsed=0

    info "Waiting for Zitadel to be ready (up to ${timeout}s)..."
    while [ $elapsed -lt "$timeout" ]; do
        if curl -sf --connect-timeout 10 --max-time 10 "${url}/debug/ready" >/dev/null 2>&1; then
            ok "Zitadel is ready (${elapsed}s)"
            return 0
        fi
        sleep 3
        elapsed=$((elapsed + 3))
        # Progress indicator every 15s
        if [ $((elapsed % 15)) -eq 0 ]; then
            info "  Still waiting... (${elapsed}s)"
        fi
    done

    error "Zitadel did not become ready within ${timeout}s"
    error "Check logs: ./deploy-public.sh logs zitadel"
    return 1
}

# ── Bootstrap Zitadel ─────────────────────────────────────────
run_bootstrap() {
    local hostname="$1"

    step "Bootstrapping Zitadel (OIDC setup)"

    export ZITADEL_URL="http://localhost:8080"
    export ZITADEL_HOST_HEADER="${hostname}:${ZITADEL_EXTERNALPORT}"
    export MACHINEKEY_PATH="$STATE_DIR/machinekey/zitadel-admin-sa.json"
    export STATE_FILE="$STATE_DIR/zitadel.env"
    export SYSTEM_API_KEY_PATH="$STATE_DIR/system-api/system-user.pem"
    export DOCKER_INTERNAL_HOST="zitadel"
    export CREATE_TEST_USER="true"
    export ZITADEL_HOSTNAME="$hostname"

    # Run bootstrap with retry
    local attempts=0
    local max_attempts=5
    while [ $attempts -lt $max_attempts ]; do
        attempts=$((attempts + 1))
        if bash "$DEPLOY_DIR/scripts/deploy/bootstrap-zitadel.sh"; then
            ok "Bootstrap complete"
            return 0
        fi
        if [ $attempts -lt $max_attempts ]; then
            warn "Bootstrap attempt $attempts failed, retrying in 5s..."
            sleep 5
        fi
    done

    error "Bootstrap failed after $max_attempts attempts"
    return 1
}

# ── Generate FM OIDC Config ──────────────────────────────────
generate_fm_config() {
    local hostname="$1"

    export FM_HOSTNAME="$hostname"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT

    bash "$DEPLOY_DIR/scripts/deploy/generate-fm-config.sh" --mode zitadel --target docker
    ok "Fleet Manager OIDC config generated"
}

# ── Commands ──────────────────────────────────────────────────

cmd_up() {
    # Parse flags
    while [ $# -gt 0 ]; do
        case "$1" in
            --with)
                case "$2" in
                    mdns) WITH_MDNS=true ;;
                    *)    warn "Unknown addon: $2" ;;
                esac
                shift 2 ;;
            --ssl)
                WITH_SSL=true
                # Next arg can be "selfsigned" or "letsencrypt" (default)
                if [ "${2:-}" = "selfsigned" ] || [ "${2:-}" = "self-signed" ]; then
                    SSL_MODE="selfsigned"; shift 2
                elif [ "${2:-}" = "letsencrypt" ]; then
                    SSL_MODE="letsencrypt"; shift 2
                else
                    SSL_MODE="letsencrypt"; shift
                fi
                ;;
            --domain)  SSL_DOMAIN="$2"; shift 2 ;;
            --email)   SSL_EMAIL="$2"; shift 2 ;;
            *)         warn "Unknown flag: $1"; shift ;;
        esac
    done

    step "Starting Fleet Management"

    # Preflight
    if ! check_docker || ! check_compose; then
        error "Docker not available. Run: ./deploy-public.sh install"
        exit 1
    fi

    for cmd in curl jq openssl; do
        if ! command -v "$cmd" &>/dev/null; then
            error "Missing required tool: $cmd. Run: ./deploy-public.sh install"
            exit 1
        fi
    done

    # SSL validation
    if [ "$WITH_SSL" = "true" ] && [ "$SSL_MODE" = "letsencrypt" ] && [ -z "$SSL_DOMAIN" ]; then
        error "Let's Encrypt SSL requires a domain: ./deploy-public.sh up --ssl --domain example.com"
        exit 1
    fi

    # Detect platform and hostname
    detect_os
    info "Platform: ${OS}/${ARCH}${DISTRO:+ ($DISTRO)}"

    local hostname
    if [ -n "$SSL_DOMAIN" ]; then
        hostname="$SSL_DOMAIN"
        info "Using domain: $hostname"
    else
        hostname=$(detect_ip)
        info "Detected IP: $hostname"
    fi

    # Export for compose and scripts
    export ZITADEL_HOSTNAME="$hostname"
    export FLEET_MANAGER_PORT
    export FM_VERSION
    export SSL_DOMAIN
    export SSL_EMAIL="${SSL_EMAIL:-admin@${SSL_DOMAIN:-localhost}}"

    # When SSL is active, Zitadel is behind Traefik on port 443
    if [ "$WITH_SSL" = "true" ]; then
        export ZITADEL_EXTERNALPORT=443
        export ZITADEL_EXTERNALSECURE=true
        if [ "$SSL_MODE" = "selfsigned" ]; then
            info "SSL enabled — self-signed certificate for $hostname"
        else
            info "SSL enabled — Traefik will provision Let's Encrypt certificate for $SSL_DOMAIN"
        fi
    else
        export ZITADEL_EXTERNALPORT
        export ZITADEL_EXTERNALSECURE=false
    fi

    # Generate passwords and state
    step "Preparing configuration"
    generate_passwords
    save_env
    generate_init_sql
    generate_system_api_keypair

    # Generate self-signed TLS cert if needed
    if [ "$WITH_SSL" = "true" ] && [ "$SSL_MODE" = "selfsigned" ]; then
        generate_selfsigned_cert "$hostname"
    fi

    # Create machinekey directory writable by Zitadel container (runs as UID 1000)
    mkdir -p "$STATE_DIR/machinekey"
    chmod 0777 "$STATE_DIR/machinekey"

    # Pre-flight: verify critical images exist before pulling
    step "Verifying Docker images"
    verify_images

    # Step 1: Start databases
    step "Starting databases"
    compose_cmd up -d fleet-db zitadel-db
    ok "Databases starting"

    # Step 2: Start Zitadel
    step "Starting Zitadel"
    compose_cmd up -d zitadel
    ok "Zitadel starting"

    # Step 3: Wait for Zitadel health
    wait_for_zitadel "http://localhost:8080"

    # Step 3b: Wait for token endpoint readiness
    # /debug/ready passes before OIDC endpoints are initialized.
    # Must use Host header — Zitadel routes by host.
    info "Waiting for token endpoint readiness (Host: ${hostname}:${ZITADEL_EXTERNALPORT})..."
    local token_elapsed=0
    while [ $token_elapsed -lt 60 ]; do
        local http_code
        http_code=$(curl -s --connect-timeout 10 --max-time 10 -o /dev/null -w '%{http_code}' \
            -X POST "http://localhost:8080/oauth/v2/token" \
            -H "Host: ${hostname}:${ZITADEL_EXTERNALPORT}" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -d "grant_type=client_credentials&client_id=probe&client_secret=probe" 2>/dev/null || echo "000")
        if [ "$http_code" != "000" ] && [ "${http_code:0:1}" != "5" ]; then
            ok "Token endpoint ready (${token_elapsed}s)"
            break
        fi
        sleep 2
        token_elapsed=$((token_elapsed + 2))
    done

    # Step 4: Bootstrap (idempotent)
    if [ ! -f "$STATE_DIR/zitadel.env" ]; then
        run_bootstrap "$hostname"
    else
        # Only re-run if hostname changed (updates redirect URIs)
        local prev_hostname=""
        prev_hostname=$(sed -n 's|^ZITADEL_ISSUER_URL=https\{0,1\}://\([^:/]*\).*|\1|p' "$STATE_DIR/zitadel.env" 2>/dev/null || true)
        if [ "$prev_hostname" != "$hostname" ]; then
            info "Hostname changed ($prev_hostname -> $hostname), re-running bootstrap"
            run_bootstrap "$hostname"
        else
            ok "Zitadel already bootstrapped (hostname unchanged)"
        fi
    fi

    # Step 5: Generate FM config
    step "Configuring Fleet Manager"
    generate_fm_config "$hostname"

    # Step 6: Start Fleet Manager + remaining services
    step "Starting Fleet Manager"
    compose_cmd up -d
    ok "All services starting"

    # Verify port mapping (diagnostic — helps debug CI failures)
    local actual_port
    actual_port=$(docker port "${COMPOSE_PROJECT_NAME}-fleet-manager-1" 7011 2>/dev/null | head -1 || true)
    info "FM port mapping: ${actual_port:-unknown} (expected 0.0.0.0:${FLEET_MANAGER_PORT})"

    # Step 7: Wait for FM health (longer timeout for RPi / slow storage)
    # Stream FM logs in background so user sees what's happening
    info "Waiting for Fleet Manager (migrations + startup)..."

    # Stream FM logs in background. Use a temp file so we can kill docker-logs
    # directly (killing only 'sed' leaves docker-logs alive if FM is idle,
    # which can keep CI process groups alive past the script's exit).
    docker logs -f "${COMPOSE_PROJECT_NAME}-fleet-manager-1" 2>&1 \
        | sed 's/^/    /' &
    local sed_pid=$!

    kill_log_tail() {
        kill "$sed_pid" 2>/dev/null || true
        # Also kill docker-logs directly — sed death only triggers SIGPIPE
        # when docker-logs writes, which may never happen if FM is idle.
        pkill -f "docker logs -f ${COMPOSE_PROJECT_NAME}-fleet-manager-1" 2>/dev/null || true
        wait "$sed_pid" 2>/dev/null || true
    }

    local elapsed=0
    local fm_timeout=120
    local health_url="http://localhost:${FLEET_MANAGER_PORT}/health"
    info "Health check target: ${health_url}"
    while [ $elapsed -lt $fm_timeout ]; do
        local curl_exit=0
        curl -sf --connect-timeout 10 --max-time 10 "$health_url" >/dev/null 2>&1 || curl_exit=$?
        if [ $curl_exit -eq 0 ]; then
            kill_log_tail
            ok "Fleet Manager is ready (${elapsed}s)"
            break
        fi
        # Log progress every 15s so CI shows the script is alive
        if [ $((elapsed % 15)) -eq 0 ] && [ $elapsed -gt 0 ]; then
            info "  Still waiting... (${elapsed}s, curl exit=$curl_exit)"
        fi
        sleep 3
        elapsed=$((elapsed + 3))
    done
    if [ $elapsed -ge $fm_timeout ]; then
        kill_log_tail
        warn "Fleet Manager did not become healthy within ${fm_timeout}s"
        # Dump diagnostics so CI logs show why
        warn "Diagnostics:"
        warn "  Port mapping: $(docker port "${COMPOSE_PROJECT_NAME}-fleet-manager-1" 7011 2>/dev/null || echo 'none')"
        warn "  Container status: $(docker inspect -f '{{.State.Status}}' "${COMPOSE_PROJECT_NAME}-fleet-manager-1" 2>/dev/null || echo 'unknown')"
        warn "  Curl to health: $(curl -sv --connect-timeout 5 --max-time 5 "$health_url" 2>&1 | head -20)"
        warn "It may still be running migrations. Check: ./deploy-public.sh logs fleet-manager"
    fi

    # Step 8: Apply retention policies (configurable via ENV)
    step "Configuring data retention"
    apply_retention_policies

    # Print summary
    print_summary "$hostname"
}

cmd_down() {
    step "Stopping Fleet Management"

    local remove_volumes=false
    for arg in "$@"; do
        case "$arg" in
            --volumes|-v) remove_volumes=true ;;
        esac
    done

    if [ -f "$STATE_DIR/.env" ]; then
        # shellcheck source=/dev/null
        source "$STATE_DIR/.env"
        export POSTGRES_PASSWORD ZITADEL_POSTGRES_PASSWORD ZITADEL_DB_USER_PASSWORD
        export ZITADEL_ADMIN_PASSWORD ZITADEL_MASTERKEY
    fi

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION

    if [ "$remove_volumes" = true ]; then
        warn "Removing containers AND volumes (all data will be lost)"
        compose_cmd down -v
        rm -rf "$STATE_DIR"
        ok "Stopped and removed all data"
    else
        compose_cmd down
        ok "Stopped (data preserved in Docker volumes)"
    fi
}

cmd_status() {
    detect_os
    step "Fleet Management Status"
    info "Platform: ${OS}/${ARCH}${DISTRO:+ ($DISTRO)}"

    if [ -f "$STATE_DIR/.env" ]; then
        # shellcheck source=/dev/null
        source "$STATE_DIR/.env"
        export POSTGRES_PASSWORD ZITADEL_POSTGRES_PASSWORD ZITADEL_DB_USER_PASSWORD
        export ZITADEL_ADMIN_PASSWORD ZITADEL_MASTERKEY
    fi

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION

    compose_cmd ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

    echo ""
    # Health checks
    local ip
    ip=$(detect_ip)

    printf "  %-20s " "Fleet Manager:"
    if curl -sf "http://localhost:${FLEET_MANAGER_PORT}/health" >/dev/null 2>&1; then
        echo "${GREEN}healthy${RESET}"
    else
        echo "${RED}unhealthy${RESET}"
    fi

    printf "  %-20s " "Zitadel:"
    if curl -sf "http://localhost:8080/debug/ready" >/dev/null 2>&1; then
        echo "${GREEN}healthy${RESET}"
    else
        echo "${RED}unhealthy${RESET}"
    fi

    printf "  %-20s " "TimescaleDB:"
    if docker exec fm-fleet-db-1 pg_isready -U postgres >/dev/null 2>&1; then
        echo "${GREEN}healthy${RESET}"
    else
        echo "${RED}unhealthy${RESET}"
    fi
}

cmd_logs() {
    if [ -f "$STATE_DIR/.env" ]; then
        # shellcheck source=/dev/null
        source "$STATE_DIR/.env"
        export POSTGRES_PASSWORD ZITADEL_POSTGRES_PASSWORD ZITADEL_DB_USER_PASSWORD
        export ZITADEL_ADMIN_PASSWORD ZITADEL_MASTERKEY
    fi

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION

    compose_cmd logs --tail 100 -f "$@"
}

cmd_update() {
    step "Updating Fleet Management"

    if [ -f "$STATE_DIR/.env" ]; then
        # shellcheck source=/dev/null
        source "$STATE_DIR/.env"
        export POSTGRES_PASSWORD ZITADEL_POSTGRES_PASSWORD ZITADEL_DB_USER_PASSWORD
        export ZITADEL_ADMIN_PASSWORD ZITADEL_MASTERKEY
    fi

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION

    info "Pulling latest images..."
    compose_cmd pull

    info "Restarting services..."
    compose_cmd up -d

    ok "Update complete"
    cmd_status
}

cmd_ip() {
    detect_os
    local ip
    ip=$(detect_ip)

    echo ""
    echo "${BOLD}Platform:${RESET}   ${OS}/${ARCH}${DISTRO:+ ($DISTRO)}"
    echo "${BOLD}Machine IP:${RESET} $ip"
    echo ""
    echo "${BOLD}Access URLs:${RESET}"
    echo "  Fleet Manager:  ${CYAN}http://${ip}:${FLEET_MANAGER_PORT}${RESET}"
    echo "  Zitadel Console: ${CYAN}http://${ip}:${ZITADEL_EXTERNALPORT}${RESET}"
    echo ""
    echo "${BOLD}Device WebSocket:${RESET}"
    echo "  ws://${ip}:${FLEET_MANAGER_PORT}/shelly"
    echo ""
}

# ── Summary ───────────────────────────────────────────────────
print_summary() {
    local hostname="$1"
    local scheme="http"
    local ws_scheme="ws"
    local fm_url zitadel_url ws_url

    if [ "$WITH_SSL" = "true" ]; then
        scheme="https"
        ws_scheme="wss"
        fm_url="${scheme}://${hostname}"
        zitadel_url="${scheme}://${hostname}"
        ws_url="${ws_scheme}://${hostname}/shelly"
    else
        fm_url="${scheme}://${hostname}:${FLEET_MANAGER_PORT}"
        zitadel_url="${scheme}://${hostname}:${ZITADEL_EXTERNALPORT}"
        ws_url="${ws_scheme}://${hostname}:${FLEET_MANAGER_PORT}/shelly"
    fi

    echo ""
    echo "${BOLD}${GREEN}=============================================${RESET}"
    echo "${BOLD}${GREEN}  Fleet Management is running!${RESET}"
    echo "${BOLD}${GREEN}=============================================${RESET}"
    echo ""
    echo "  ${BOLD}Platform:${RESET}        ${OS:-unknown}/${ARCH:-unknown}${DISTRO:+ ($DISTRO)}"
    echo "  ${BOLD}Fleet Manager:${RESET}   ${CYAN}${fm_url}${RESET}"
    echo "  ${BOLD}Zitadel Console:${RESET} ${CYAN}${zitadel_url}${RESET}"
    echo ""
    echo "  ${BOLD}Default Login:${RESET}"
    echo "    Username: ${CYAN}${FM_ADMIN_USER}${RESET}"
    echo "    Password: ${CYAN}${FM_ADMIN_PASSWORD}${RESET}"
    echo ""
    echo "  ${BOLD}Zitadel Admin:${RESET}"
    echo "    Username: ${CYAN}root${RESET}"
    echo "    Password: ${CYAN}${ZITADEL_ADMIN_PASSWORD}${RESET}"
    echo ""
    if [ "$SSL_MODE" = "selfsigned" ]; then
        echo "  ${BOLD}${YELLOW}Self-signed certificate:${RESET}"
        echo "    Browsers will show a security warning — this is expected."
        echo "    To trust it, install the CA cert on your devices:"
        echo "    ${CYAN}${STATE_DIR}/tls/ca.crt${RESET}"
        echo ""
    fi
    echo "  ${BOLD}Connect a Shelly device:${RESET}"
    echo "    Device Web UI > Networks > Outbound WebSocket"
    echo "    URL: ${CYAN}${ws_url}${RESET}"
    echo ""
    echo "  ${BOLD}Data Retention:${RESET}"
    echo "    Telemetry:  ${CYAN}${STATUS_RETENTION:-7 days}${RESET}"
    echo "    Energy:     ${CYAN}${EM_STATS_RETENTION:-1 year}${RESET}"
    echo "    Audit logs: ${CYAN}${AUDIT_LOG_RETENTION:-90 days}${RESET}"
    echo "    Edit ${CYAN}deploy/env/public.env${RESET} to change"
    echo ""
    echo "  ${BOLD}Commands:${RESET}"
    echo "    ./deploy-public.sh status   Show service status"
    echo "    ./deploy-public.sh logs     Show logs"
    echo "    ./deploy-public.sh down     Stop services"
    echo "    ./deploy-public.sh update   Pull latest & restart"
    echo ""
}

# ── Doctor ─────────────────────────────────────────────────────
cmd_doctor() {
    echo ""
    echo "${BOLD}Fleet Management — System Diagnostics${RESET}"
    echo ""

    local issues=0

    # 1. Docker
    step "Docker"
    if command -v docker &>/dev/null; then
        ok "Docker installed: $(docker --version 2>/dev/null | grep -o '[0-9][0-9.]*' | head -1)"
    else
        error "Docker not installed"; issues=$((issues + 1))
    fi
    if docker info &>/dev/null 2>&1; then
        ok "Docker daemon running"
    else
        error "Docker daemon not running or no permissions"; issues=$((issues + 1))
    fi
    if docker compose version &>/dev/null 2>&1; then
        ok "Docker Compose: $(docker compose version --short 2>/dev/null)"
    else
        error "Docker Compose (v2) not found"; issues=$((issues + 1))
    fi

    # 2. Required tools
    step "Required tools"
    for cmd in curl jq openssl; do
        if command -v "$cmd" &>/dev/null; then
            ok "$cmd"
        else
            error "Missing: $cmd"; issues=$((issues + 1))
        fi
    done

    # 3. Docker images
    step "Docker images (from VERSIONS.env)"
    if [ -f "$VERSIONS_FILE" ]; then
        # shellcheck source=/dev/null
        source "$VERSIONS_FILE"
    fi
    local images=(
        "timescale/timescaledb:${TIMESCALEDB_VERSION:-?}"
        "postgres:${ZITADEL_POSTGRES_VERSION:-?}"
        "ghcr.io/zitadel/zitadel:${ZITADEL_VERSION:-?}"
        "${DOCKER_HUB_IMAGE}:${FM_VERSION:-?}"
        "traefik:${TRAEFIK_VERSION:-?}"
    )
    for img in "${images[@]}"; do
        if docker manifest inspect "$img" >/dev/null 2>&1; then
            ok "$img"
        else
            error "Not found: $img"; issues=$((issues + 1))
        fi
    done

    # 4. Ports
    step "Port availability"
    for port in "${FLEET_MANAGER_PORT:-7011}" "${ZITADEL_EXTERNALPORT:-9090}" 80 443; do
        if ! ss -tlnp 2>/dev/null | grep -q ":${port} " && \
           ! lsof -i ":${port}" -sTCP:LISTEN &>/dev/null 2>&1; then
            ok "Port $port available"
        else
            warn "Port $port in use (may be a running FM instance)"
        fi
    done

    # 5. State directory
    step "State directory"
    if [ -d "$STATE_DIR" ]; then
        ok "Exists: $STATE_DIR"
        [ -f "$STATE_DIR/.env" ]        && ok "Passwords: .env" || info "No .env (first run)"
        [ -f "$STATE_DIR/zitadel.env" ] && ok "Bootstrap: zitadel.env" || info "No zitadel.env (not bootstrapped)"
        [ -f "$STATE_DIR/fm-oidc.env" ] && ok "OIDC config: fm-oidc.env" || info "No fm-oidc.env (not configured)"
    else
        info "State directory does not exist (will be created on first run)"
    fi

    # 6. Network
    step "Network"
    local ip
    ip=$(detect_ip)
    ok "Detected IP: $ip"
    if curl -sf --max-time 5 "https://hub.docker.com" >/dev/null 2>&1; then
        ok "Docker Hub reachable"
    else
        warn "Cannot reach Docker Hub (images must be pre-pulled)"
    fi

    # 7. Disk space
    step "Disk space"
    local avail_kb
    avail_kb=$(df -k "$DEPLOY_DIR" 2>/dev/null | awk 'NR==2{print $4}')
    if [ -n "$avail_kb" ]; then
        local avail_gb=$((avail_kb / 1024 / 1024))
        if [ "$avail_gb" -ge 20 ]; then
            ok "${avail_gb}GB available (minimum: 20GB)"
        elif [ "$avail_gb" -ge 10 ]; then
            warn "${avail_gb}GB available (recommended: 20GB+)"
        else
            error "Only ${avail_gb}GB available (minimum: 20GB)"; issues=$((issues + 1))
        fi
    fi

    # 8. Running services
    step "Running services"
    if docker ps --filter "name=^${COMPOSE_PROJECT_NAME:-fm}-" --format '{{.Names}}: {{.Status}}' 2>/dev/null | head -10 | grep -q .; then
        docker ps --filter "name=^${COMPOSE_PROJECT_NAME:-fm}-" --format '{{.Names}}: {{.Status}}' 2>/dev/null | while read -r line; do
            if echo "$line" | grep -q "healthy"; then
                ok "$line"
            elif echo "$line" | grep -q "Up"; then
                ok "$line"
            else
                warn "$line"
            fi
        done
    else
        info "No Fleet Management containers running"
    fi

    # Summary
    echo ""
    if [ $issues -eq 0 ]; then
        echo "${BOLD}${GREEN}All checks passed. System is ready.${RESET}"
    else
        echo "${BOLD}${RED}Found $issues issue(s). Fix them before running ./deploy-public.sh up${RESET}"
    fi
    echo ""
}

# ── Help ──────────────────────────────────────────────────────
cmd_help() {
    echo ""
    echo "${BOLD}Fleet Management${RESET} v${FM_SCRIPT_VERSION}"
    echo ""
    echo "${BOLD}Usage:${RESET} ./deploy-public.sh <command>"
    echo ""
    echo "${BOLD}Commands:${RESET}"
    echo "  ${CYAN}install${RESET}                          Install Docker and dependencies"
    echo "  ${CYAN}up${RESET}                               Start Fleet Management"
    echo "  ${CYAN}up --with mdns${RESET}                   Start with mDNS device discovery"
    echo "  ${CYAN}up --ssl --domain fm.example.com${RESET} Start with HTTPS (Let's Encrypt)"
    echo "  ${CYAN}up --ssl selfsigned${RESET}              Start with HTTPS (self-signed cert)"
    echo "  ${CYAN}down${RESET}                             Stop Fleet Management"
    echo "  ${CYAN}down --volumes${RESET}                   Stop and remove all data"
    echo "  ${CYAN}status${RESET}                           Show service status and health"
    echo "  ${CYAN}logs${RESET} [service]                   Show logs (follow mode)"
    echo "  ${CYAN}update${RESET}                           Pull latest images and restart"
    echo "  ${CYAN}ip${RESET}                               Show machine IP and access URLs"
    echo "  ${CYAN}doctor${RESET}                           Check system readiness"
    echo "  ${CYAN}help${RESET}                             Show this help"
    echo ""
    echo "${BOLD}Supported platforms:${RESET}"
    echo "  Ubuntu/Debian, Raspberry Pi OS (arm64), Arch Linux, macOS"
    echo ""
    echo "${BOLD}Hardware requirements:${RESET}"
    echo "  Minimum: 4GB RAM, 2 CPU cores, 20GB disk (up to ~50 devices)"
    echo "  Recommended: 8GB RAM, 4 CPU cores, 64GB SSD (up to ~300 devices)"
    echo "  RPi 4B/5 (8GB): works well — use USB SSD instead of SD card for database"
    echo ""
    echo "${BOLD}Storage estimates (300 devices, default retention):${RESET}"
    echo "  Docker images:     ~2GB (one-time)"
    echo "  Device telemetry:  ~500MB (7 day retention, auto-compressed)"
    echo "  Energy meter data: ~5GB/year (1 year retention, auto-compressed)"
    echo "  Audit logs:        ~200MB/year (90 day retention)"
    echo "  Zitadel + auth DB: ~500MB"
    echo "  Total first year:  ~9GB — easily fits on 64GB SSD"
    echo ""
    echo "${BOLD}Configuration:${RESET}"
    echo "  Edit ${CYAN}deploy/env/public.env${RESET} to change memory, retention, and tuning."
    echo "  Key settings: FM_HEAP_SIZE, PG_SHARED_BUFFERS, STATUS_RETENTION, EM_STATS_RETENTION"
    echo ""
    echo "${BOLD}Environment overrides:${RESET}"
    echo "  FM_VERSION=${FM_VERSION}  FLEET_MANAGER_PORT=${FLEET_MANAGER_PORT}  ZITADEL_EXTERNALPORT=${ZITADEL_EXTERNALPORT}"
    echo ""
}

# ── Main ──────────────────────────────────────────────────────
main() {
    local command="${1:-help}"
    shift || true

    case "$command" in
        install)  cmd_install ;;
        up)       cmd_up "$@" ;;
        down)     cmd_down "$@" ;;
        status)   cmd_status ;;
        logs)     cmd_logs "$@" ;;
        update)   cmd_update ;;
        ip)       cmd_ip ;;
        doctor)   cmd_doctor ;;
        help|-h|--help) cmd_help ;;
        *)
            error "Unknown command: $command"
            cmd_help
            exit 1
            ;;
    esac
}

main "$@"
