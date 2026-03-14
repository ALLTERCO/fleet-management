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
#   ./deploy/deploy-public.sh up             Start (idempotent: installs deps, bootstraps or restarts)
#   ./deploy/deploy-public.sh upgrade        Pull newer images, then restart
#   ./deploy/deploy-public.sh down           Stop (keep data)
#   ./deploy/deploy-public.sh down --volumes Stop and delete all data
#   ./deploy/deploy-public.sh status         Show service status
#   ./deploy/deploy-public.sh logs [service] Show logs
#   ./deploy/deploy-public.sh ip             Show access URLs
#   ./deploy/deploy-public.sh doctor         Troubleshoot configuration
#   ./deploy/deploy-public.sh help           Show help
#
# Image pull behavior:
#   'up'      — uses cached images; pulls only if missing (first run)
#   'upgrade' — pulls all images from registry, then runs 'up'
#
# Environment overrides (set before running):
#   FM_VERSION           Fleet Manager version (default: latest)
#   FLEET_MANAGER_PORT   FM port (default: 7011)
#   ZITADEL_EXTERNALPORT Zitadel port (default: 9090)
#   POSTGRES_PASSWORD    TimescaleDB password (default: auto-generated)

set -euo pipefail

# ── Source library modules ────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/ssl.sh"
source "$SCRIPT_DIR/lib/docker.sh"
source "$SCRIPT_DIR/lib/install.sh"
source "$SCRIPT_DIR/lib/state.sh"
source "$SCRIPT_DIR/lib/compose.sh"
source "$SCRIPT_DIR/lib/zitadel.sh"

# ── Commands ──────────────────────────────────────────────────

cmd_up() {
    parse_runtime_flags "$@" || return 1
    enable_debug_mode

    echo ""
    echo "  ${BOLD}${WHITE}Fleet Manager${RESET}"
    echo ""

    phase "Phase 1/4 — Prerequisites"
    ensure_prereqs_for_up || exit 1

    # Detect platform and hostname
    detect_os
    info "Platform: ${OS}/${ARCH}${DISTRO:+ ($DISTRO)}"

    local hostname
    if [ -n "$SSL_DOMAIN" ]; then
        hostname="$SSL_DOMAIN"
        info "Using domain: $hostname"
    else
        hostname=$(detect_ip)

        # Check for multiple real network interfaces
        local all_ips ip_count
        all_ips=$(detect_all_ips)
        ip_count=$(echo "$all_ips" | grep -c . || true)

        if [ "$ip_count" -gt 1 ] && [ -t 0 ]; then
            # Interactive terminal — let the user choose
            warn "Multiple network interfaces detected:"
            local i=1
            local ip_list=()
            while read -r addr; do
                [ -z "$addr" ] && continue
                ip_list+=("$addr")
                if [ "$addr" = "$hostname" ]; then
                    info "  $i) $addr  ← default route"
                else
                    info "  $i) $addr"
                fi
                i=$((i + 1))
            done <<< "$all_ips"

            printf "\n  Select IP [1-%d, or Enter for default]: " "${#ip_list[@]}"
            read -r choice
            if [ -n "$choice" ] && [ "$choice" -ge 1 ] 2>/dev/null && [ "$choice" -le "${#ip_list[@]}" ] 2>/dev/null; then
                hostname="${ip_list[$((choice - 1))]}"
            fi
            info "Using IP: $hostname"
        elif [ "$ip_count" -gt 1 ]; then
            # Non-interactive (CI) — auto-select, print warning
            info "Detected IP: $hostname"
            warn "Multiple network interfaces detected (auto-selected default route)"
            info "To override, set ZITADEL_HOSTNAME to the correct IP"
        else
            info "Detected IP: $hostname"
        fi
    fi

    validate_ssl_config || exit 1

    # Check ports before starting anything
    step "Checking port availability"
    check_required_ports || exit 1

    # Export for compose and scripts
    export ZITADEL_HOSTNAME="$hostname"
    export FLEET_MANAGER_PORT
    export FM_VERSION
    export SSL_DOMAIN
    export SSL_EMAIL="${SSL_EMAIL:-admin@${SSL_DOMAIN:-localhost}}"

    # When SSL is active, public HTTPS is always on port 443 (no custom port support).
    # Traefik terminates TLS; backends are plain HTTP on the Docker bridge.
    if [ "$WITH_SSL" = "true" ]; then
        export ZITADEL_EXTERNALPORT=443
        export ZITADEL_EXTERNALSECURE=true
        export ZITADEL_TLS_MODE=external
        if [ "$SSL_MODE" = "selfsigned" ]; then
            info "SSL enabled — self-signed certificate for $hostname"
        elif [ "$SSL_MODE" = "custom" ]; then
            info "SSL enabled — using custom certificate for $hostname"
        else
            info "SSL enabled — Traefik will provision Let's Encrypt certificate for $SSL_DOMAIN"
        fi
    else
        export ZITADEL_EXTERNALPORT
        export ZITADEL_EXTERNALSECURE=false
        export ZITADEL_TLS_MODE=disabled
    fi

    phase "Phase 2/4 — Configuration"
    generate_passwords
    save_env
    save_deploy_meta "$hostname" "up"
    generate_init_sql
    generate_system_api_keypair

    # Generate TLS certs and Traefik routing config
    if [ "$WITH_SSL" = "true" ]; then
        case "$SSL_MODE" in
            selfsigned)
                generate_selfsigned_cert "$hostname"
                write_traefik_routes_selfsigned
                ;;
            custom)
                install_custom_cert
                write_traefik_routes_selfsigned
                ;;
            letsencrypt)
                write_traefik_routes_letsencrypt "$SSL_DOMAIN"
                ;;
        esac
    fi

    # Create machinekey directory writable by Zitadel container (runs as UID 1000)
    mkdir -p "$STATE_DIR/machinekey"
    chmod 0777 "$STATE_DIR/machinekey"

    phase "Phase 3/4 — Containers"
    verify_images

    if run_quiet "Starting database containers" compose_cmd up -d fleet-db zitadel-db; then
        ok "Databases started"
    else
        error "Failed to start database containers"
        return 1
    fi

    if run_quiet "Starting Zitadel container" compose_cmd up -d zitadel; then
        ok "Zitadel started"
    else
        error "Failed to start Zitadel container"
        return 1
    fi

    # Step 3: Wait for Zitadel health
    wait_for_zitadel "http://localhost:8080"

    # Step 3b: Wait for token endpoint readiness
    # /debug/ready passes before OIDC endpoints are initialized.
    # Must use Host header — Zitadel routes by host.
    # Strip default ports (443/HTTPS, 80/HTTP) — Zitadel uses exact Host match.
    local _probe_host="${hostname}:${ZITADEL_EXTERNALPORT}"
    if [ "${ZITADEL_EXTERNALSECURE:-false}" = "true" ]; then
        _probe_host="${_probe_host%:443}"
    else
        _probe_host="${_probe_host%:80}"
    fi
    spinner_start "Waiting for token endpoint... (up to 60s)"
    local token_elapsed=0
    while [ $token_elapsed -lt 60 ]; do
        local http_code
        http_code=$(curl -s --connect-timeout 10 --max-time 10 -o /dev/null -w '%{http_code}' \
            -X POST "http://localhost:8080/oauth/v2/token" \
            -H "Host: ${_probe_host}" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -d "grant_type=client_credentials&client_id=probe&client_secret=probe" 2>/dev/null || echo "000")
        if [ "$http_code" != "000" ] && [ "${http_code:0:1}" != "5" ]; then
            spinner_stop ok "Token endpoint ready (${token_elapsed}s)"
            break
        fi
        sleep 2
        token_elapsed=$((token_elapsed + 2))
        spinner_update "Waiting for token endpoint... (${token_elapsed}s)"
    done
    if [ $token_elapsed -ge 60 ]; then
        spinner_stop fail "Token endpoint did not become ready within 60s"
        error "Check logs: ./deploy/deploy-public.sh logs zitadel"
        return 1
    fi

    # Step 4: Bootstrap (idempotent)
    if [ ! -f "$STATE_DIR/zitadel.env" ]; then
        run_bootstrap "$hostname" || return 1
    else
        # Only re-run if hostname changed (updates redirect URIs)
        local prev_hostname=""
        prev_hostname=$(sed -n 's|^ZITADEL_ISSUER_URL=https\{0,1\}://\([^:/]*\).*|\1|p' "$STATE_DIR/zitadel.env" 2>/dev/null || true)
        if [ "$prev_hostname" != "$hostname" ]; then
            info "Hostname changed ($prev_hostname -> $hostname), re-running bootstrap"
            run_bootstrap "$hostname" || return 1
        else
            ok "Zitadel already bootstrapped (hostname unchanged)"
        fi
    fi

    generate_fm_config "$hostname" || return 1

    if run_quiet "Starting Fleet Manager containers" compose_cmd up -d; then
        ok "All services started"
    else
        error "Failed to start Fleet Manager containers"
        return 1
    fi

    if [ "$WITH_SSL" != "true" ]; then
        local actual_port
        actual_port=$(docker port "$(container_name fleet-manager)" 7011 2>/dev/null | head -1 || true)
        debug "FM port mapping: ${actual_port:-unknown} (expected 0.0.0.0:${FLEET_MANAGER_PORT})"
    fi

    # Wait for FM health (longer timeout for RPi / slow storage)
    # Stream FM logs in background so user sees what's happening
    # In debug mode, stream raw FM logs so the operator sees everything.
    local sed_pid=""
    kill_log_tail() {
        if [ -n "$sed_pid" ]; then
            kill "$sed_pid" 2>/dev/null || true
            pkill -f "docker logs -f $(container_name fleet-manager)" 2>/dev/null || true
            wait "$sed_pid" 2>/dev/null || true
        fi
    }
    if [ "$DEBUG_MODE" = "true" ]; then
        docker logs -f "$(container_name fleet-manager)" 2>&1 \
            | sed 's/^/    /' &
        sed_pid=$!
    fi

    spinner_start "Fleet Manager starting..."
    local elapsed=0
    local fm_timeout=120
    local health_status=""
    while [ $elapsed -lt $fm_timeout ]; do
        health_status="$(container_health_status "$(container_name fleet-manager)")"
        if [ "$health_status" = "healthy" ] || [ "$health_status" = "running" ]; then
            kill_log_tail
            spinner_stop ok "Fleet Manager ready (${elapsed}s)"
            break
        fi
        sleep 3
        elapsed=$((elapsed + 3))
        spinner_update "Fleet Manager starting... (${elapsed}s)"
    done
    if [ $elapsed -ge $fm_timeout ]; then
        kill_log_tail
        spinner_stop fail "Fleet Manager did not start within ${fm_timeout}s"
        warn "Health: $(container_health_status "$(container_name fleet-manager)")"
        warn "State: $(docker inspect -f '{{.State.Status}}' "$(container_name fleet-manager)" 2>/dev/null || echo 'unknown')"
        if [ "$WITH_SSL" != "true" ]; then
            warn "Port: $(docker port "$(container_name fleet-manager)" 7011 2>/dev/null || echo 'none')"
        fi
        warn "Check: ./deploy/deploy-public.sh logs fleet-manager"
        return 1
    fi

    if [ "$WITH_SSL" = "true" ]; then
        spinner_start "Traefik starting..."
        if ! wait_for_container_health "traefik" 60; then
            spinner_stop fail "Traefik did not become healthy within 60s"
            warn "Check: ./deploy/deploy-public.sh logs traefik"
            return 1
        fi
        spinner_stop ok "Traefik ready"
    fi

    phase "Phase 4/4 — Finalization"
    apply_retention_policies

    # Print summary
    print_summary "$hostname"
}

cmd_down() {
    enable_debug_mode

    local remove_volumes=false
    local skip_confirm=false
    for arg in "$@"; do
        case "$arg" in
            --volumes|-v) remove_volumes=true ;;
            --yes|-y) skip_confirm=true ;;
            --volume)
                error "Unknown flag: --volume"
                info "Did you mean --volumes?"
                return 1
                ;;
            *)
                error "Unknown flag for down: $arg"
                info "Supported flags: --volumes, --yes"
                return 1
                ;;
        esac
    done

    load_state_env
    load_deploy_meta

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION

    echo ""
    if [ "$remove_volumes" = true ]; then
        # Destructive: confirm before deleting all data
        if [ "$skip_confirm" != true ] && [ -t 0 ]; then
            warn "This will permanently delete ALL data:"
            warn "  - Database contents (devices, telemetry, energy data, audit logs)"
            warn "  - OIDC configuration and credentials"
            warn "  - TLS certificates"
            warn "  - All Docker volumes"
            echo ""
            printf "  Type 'yes' to confirm: "
            local confirm=""
            read -r confirm
            if [ "$confirm" != "yes" ]; then
                info "Aborted."
                return 0
            fi
        fi
        spinner_start "Stopping and removing data..."
        if run_quiet "Stopping containers and removing volumes" compose_cmd down -v; then
            cleanup_orphan_optional_containers || true
            rm -rf "$STATE_DIR"
            spinner_stop ok "Stopped and removed all data (run 'up' for fresh deploy)"
        else
            spinner_stop fail "Failed to stop containers and remove volumes"
            return 1
        fi
    else
        spinner_start "Stopping services..."
        if run_quiet "Stopping containers" compose_cmd down; then
            cleanup_orphan_optional_containers || true
            save_deploy_meta "" "down"
            spinner_stop ok "Stopped (data preserved in Docker volumes)"
        else
            spinner_stop fail "Failed to stop services"
            return 1
        fi
    fi
    echo ""
}

cmd_status() {
    enable_debug_mode
    detect_os

    load_state_env
    load_deploy_meta

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION

    echo ""
    step "Fleet Management Status"
    info "Platform: ${OS}/${ARCH}${DISTRO:+ ($DISTRO)}"
    echo ""

    compose_cmd ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

    echo ""
    local svc_status
    local services=(fleet-manager zitadel fleet-db)
    if [ "$WITH_SSL" = "true" ]; then
        services+=(traefik)
    fi
    for svc in "${services[@]}"; do
        svc_status="$(container_health_status "$(container_name "$svc")" 2>/dev/null || echo "unknown")"
        if [ "$svc_status" = "healthy" ]; then
            printf "  ${GREEN}✔${RESET}  %-18s %s\n" "$svc" "${GREEN}${svc_status}${RESET}"
        elif [ "$svc_status" = "running" ]; then
            printf "  ${GREEN}✔${RESET}  %-18s %s\n" "$svc" "${svc_status}"
        else
            printf "  ${RED}✘${RESET}  %-18s %s\n" "$svc" "${RED}${svc_status}${RESET}"
        fi
    done
    echo ""
}

cmd_logs() {
    enable_debug_mode
    load_state_env
    load_deploy_meta

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION

    compose_cmd logs --tail 100 -f "$@"
}

cmd_upgrade() {
    # upgrade = pull newer images, then run the full idempotent 'up' flow.
    #
    # Image pull behavior (matches industry standard: docker compose pull && up):
    #   - Existing deployment: pulls all configured images, Compose skips unchanged digests
    #   - Fresh machine / after down --volumes: no state yet, skip pull — 'up' will
    #     pull missing images automatically via Compose (pull_policy: missing)
    #
    # After pulling, delegates to cmd_up for the full bootstrap-or-restart flow.
    parse_runtime_flags "$@" || return 1
    enable_debug_mode

    echo ""
    step "Upgrading Fleet Management"

    # Need previous config to build the compose command (env files, compose overlays)
    load_state_env
    load_deploy_meta

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION

    if [ -f "$STATE_DIR/.env" ]; then
        spinner_start "Pulling newer images..."
        if run_quiet "Pulling configured image tags" compose_cmd pull; then
            spinner_stop ok "Images pulled"
        else
            spinner_stop warn "Pull failed — will use local cache"
        fi
    else
        info "No prior deployment — 'up' will pull images on first start"
    fi

    cmd_up "$@"
}

cmd_ip() {
    enable_debug_mode
    detect_os
    load_deploy_meta
    local ip
    ip=$(detect_ip)

    echo ""
    echo "${BOLD}Platform:${RESET}   ${OS}/${ARCH}${DISTRO:+ ($DISTRO)}"
    echo "${BOLD}Machine IP:${RESET} $ip"
    echo ""
    echo "${BOLD}Access URLs:${RESET}"
    if [ "$WITH_SSL" = "true" ]; then
        local hostname="${SSL_DOMAIN:-${DEPLOY_HOSTNAME:-$ip}}"
        echo "  Fleet Manager:  ${CYAN}https://${hostname}${RESET}"
        echo "  Zitadel Console: ${CYAN}https://${hostname}${RESET}"
        echo ""
        echo "${BOLD}Device WebSocket:${RESET}"
        echo "  wss://${hostname}/shelly"
    else
        echo "  Fleet Manager:  ${CYAN}http://${ip}:${FLEET_MANAGER_PORT}${RESET}"
        echo "  Zitadel Console: ${CYAN}http://${ip}:${ZITADEL_EXTERNALPORT}${RESET}"
        echo ""
        echo "${BOLD}Device WebSocket:${RESET}"
        echo "  ws://${ip}:${FLEET_MANAGER_PORT}/shelly"
    fi
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

    local DIM="${BLUE}"
    local SEP="${DIM}──────────────────────────────────────────────${RESET}"

    echo ""
    echo "${BOLD}${GREEN}  ✔  Fleet Management is running${RESET}"
    echo "${SEP}"
    echo ""
    echo "  ${DIM}Platform${RESET}         ${OS:-unknown}/${ARCH:-unknown}${DISTRO:+ ($DISTRO)}"
    echo "  ${DIM}Fleet Manager${RESET}    ${CYAN}${fm_url}${RESET}"
    echo "  ${DIM}Zitadel Console${RESET}  ${CYAN}${zitadel_url}${RESET}"
    if [ "$WITH_LOGGING" = "true" ]; then
        echo "  ${DIM}Log Viewer${RESET}       ${CYAN}http://${hostname}:${DOZZLE_PORT:-9999}${RESET}"
    fi
    echo ""
    echo "${SEP}"
    echo "  ${BOLD}Login${RESET}"
    echo "  ${DIM}Username${RESET}  ${CYAN}${FM_ADMIN_USER}${RESET}"
    echo "  ${DIM}Password${RESET}  ${CYAN}${FM_ADMIN_PASSWORD}${RESET}"
    echo ""
    echo "${SEP}"
    echo "  ${BOLD}Connect a Shelly device${RESET}"
    echo "  ${DIM}WebSocket${RESET}  ${CYAN}${ws_url}${RESET}"
    if [ "$SSL_MODE" = "selfsigned" ]; then
        echo ""
        echo "  ${YELLOW}Self-signed TLS — configure each device:${RESET}"
        echo "  ${DIM}1.${RESET} Upload CA        Settings > TLS Configuration > Custom CA PEM bundle"
        echo "                      File: ${CYAN}${STATE_DIR}/tls/ca.crt${RESET}"
        echo "  ${DIM}2.${RESET} Connection type  Outbound WebSocket > ${CYAN}User TLS${RESET}"
        echo "  ${DIM}3.${RESET} Server           ${CYAN}${ws_url}${RESET}"
    fi
    echo ""
    echo "${SEP}"
    echo "  ${BOLD}Data retention${RESET}"
    echo "  ${DIM}Telemetry${RESET}   ${STATUS_RETENTION:-7 days}"
    echo "  ${DIM}Energy${RESET}      ${EM_STATS_RETENTION:-1 year}"
    echo "  ${DIM}Audit logs${RESET}  ${AUDIT_LOG_RETENTION:-90 days}"
    echo ""
    echo "${SEP}"
    echo "  ${BOLD}Commands${RESET}"
    echo "  ${CYAN}./deploy/deploy-public.sh status${RESET}    Service health"
    echo "  ${CYAN}./deploy/deploy-public.sh logs${RESET}      Follow logs"
    echo "  ${CYAN}./deploy/deploy-public.sh down${RESET}      Stop services"
    echo "  ${CYAN}./deploy/deploy-public.sh upgrade${RESET}   Pull newer images & restart"
    echo ""
}

# ── Doctor ─────────────────────────────────────────────────────
cmd_doctor() {
    parse_runtime_flags "$@" || return 1
    enable_debug_mode
    load_state_env
    load_deploy_meta

    echo ""
    echo "${BOLD}Fleet Management — System Diagnostics${RESET}"
    echo ""

    local issues=0

    # 1. Docker
    step "Docker"
    if docker_cli_exists; then
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
    if [ -n "${BASH_VERSION:-}" ]; then
        ok "Bash: ${BASH_VERSION%%(*}"
    else
        warn "Could not determine Bash version"
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
    step "Docker images (local cache)"
    if [ -f "$VERSIONS_FILE" ]; then
        # shellcheck source=/dev/null
        source "$VERSIONS_FILE"
    fi
    local images=(
        "timescale/timescaledb:${TIMESCALEDB_VERSION:-?}"
        "postgres:${ZITADEL_POSTGRES_VERSION:-?}"
        "ghcr.io/zitadel/zitadel:${ZITADEL_VERSION:-?}"
        "${DOCKER_HUB_IMAGE}:${FM_VERSION:-?}"
    )
    if [ "$WITH_SSL" = "true" ]; then
        images+=("traefik:${TRAEFIK_VERSION:-?}")
    fi
    for img in "${images[@]}"; do
        if local_image_exists "$img"; then
            ok "$img"
        else
            warn "Not cached locally: $img (will be pulled on up)"
        fi
    done

    # 4. Ports
    step "Port availability"
    local ports=()
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
            warn "Port $port in use (may be a running FM instance)"
        fi
    done

    # 5. State directory
    step "State directory"
    if [ -d "$STATE_DIR" ]; then
        ok "Exists: $STATE_DIR"
        [ -f "$STATE_DIR/.env" ]        && ok "Passwords: .env" || info "No .env (first run)"
        [ -f "$DEPLOY_META_FILE" ]      && ok "Deploy meta: deploy-meta.env" || info "No deploy-meta.env (topology not saved yet)"
        [ -f "$STATE_DIR/zitadel.env" ] && ok "Bootstrap: zitadel.env" || info "No zitadel.env (not bootstrapped)"
        [ -f "$STATE_DIR/fm-oidc.env" ] && ok "OIDC config: fm-oidc.env" || info "No fm-oidc.env (not configured)"
    else
        info "State directory does not exist (will be created on first run)"
    fi

    # 6. SSL mode
    step "SSL configuration"
    if [ "$WITH_SSL" = "true" ]; then
        if validate_ssl_config; then
            ok "SSL configuration valid (${SSL_MODE})"
            if [ "$SSL_MODE" = "selfsigned" ] || [ "$SSL_MODE" = "custom" ]; then
                [ -f "$STATE_DIR/tls/server.crt" ] && ok "Traefik certificate: server.crt" || warn "No installed server.crt yet"
                [ -f "$STATE_DIR/tls/server.key" ] && ok "Traefik key: server.key" || warn "No installed server.key yet"
            fi
        else
            issues=$((issues + 1))
        fi
    else
        info "SSL disabled (direct port mode)"
    fi

    # 7. Network
    step "Network"
    local ip all_ips ip_count
    all_ips=$(detect_all_ips)
    ip_count=$(echo "$all_ips" | grep -c . || true)
    ip=$(detect_ip 2>/dev/null)
    ok "Primary IP: $ip"
    if [ "$ip_count" -gt 1 ]; then
        warn "Multiple interfaces detected ($ip_count IPs) — verify devices can reach $ip"
    fi
    if curl -sf --max-time 5 "https://hub.docker.com" >/dev/null 2>&1; then
        ok "Docker Hub reachable"
    else
        warn "Cannot reach Docker Hub (images must be pre-pulled)"
    fi
    if curl -sf --max-time 5 "https://ghcr.io" >/dev/null 2>&1; then
        ok "GHCR reachable"
    else
        warn "Cannot reach GHCR"
    fi

    # 8. Disk space
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

    # 9. Running services
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
        echo "${BOLD}${RED}Found $issues issue(s). Fix them before running ./deploy/deploy-public.sh up${RESET}"
    fi
    echo ""
}

# ── Help ──────────────────────────────────────────────────────
cmd_help() {
    echo ""
    echo "${BOLD}Fleet Management${RESET} v${FM_SCRIPT_VERSION}"
    echo ""
    echo "${BOLD}Usage:${RESET} ./deploy/deploy-public.sh <command>"
    echo ""
    echo "${BOLD}Commands:${RESET}"
    echo "  ${CYAN}up${RESET}                               Start Fleet Management (idempotent: bootstrap or restart)"
    echo "  ${CYAN}up --mdns${RESET}                        Start with mDNS device discovery"
    echo "  ${CYAN}up --logging${RESET}                     Start with Dozzle log viewer (port ${DOZZLE_PORT:-9999})"
    echo "  ${CYAN}up --ssl --domain fm.example.com${RESET} Start with HTTPS (Let's Encrypt)"
    echo "  ${CYAN}up --ssl selfsigned${RESET}              Start with HTTPS (self-signed cert)"
    echo "  ${CYAN}up --ssl custom --domain fm.example.com --cert /path/fullchain.pem --key /path/privkey.pem${RESET}"
    echo "                                     Start with HTTPS (custom certificate)"
    echo "  ${CYAN}upgrade${RESET}                          Pull newer images, then restart (same as: pull + up)"
    echo "  ${CYAN}down${RESET}                             Stop Fleet Management and keep data"
    echo "  ${CYAN}down --volumes${RESET}                   Stop Fleet Management and delete all data (asks for confirmation)"
    echo "  ${CYAN}down --volumes --yes${RESET}             Same as above, skip confirmation (for scripting/CI)"
    echo "  ${CYAN}status${RESET}                           Show service status and health"
    echo "  ${CYAN}logs${RESET} [service]                   Show logs (follow mode)"
    echo "  ${CYAN}ip${RESET}                               Show access URLs"
    echo "  ${CYAN}doctor${RESET} [--ssl ...]               Troubleshoot readiness, dependencies, and SSL configuration"
    echo "  ${CYAN}help${RESET}                             Show this help"
    echo ""
    echo "${BOLD}Global Options:${RESET}"
    echo "  ${CYAN}--debug${RESET}                           Print traced shell commands and extra diagnostics"
    echo "                                    Normal mode keeps installers and Docker orchestration quiet unless something fails."
    echo ""
    echo "${BOLD}Public Quick Start:${RESET}"
    echo "  ${CYAN}./deploy/deploy-public.sh up${RESET} is idempotent — bootstraps on first run, restarts on subsequent runs."
    echo "  On Linux this may prompt for sudo during the first run."
    echo "  On macOS it may trigger Homebrew or Docker Desktop permission/setup prompts."
    echo ""
    echo "${BOLD}Which SSL Mode?${RESET}"
    echo "  ${CYAN}selfsigned${RESET}  For anything not publicly issuable by Let's Encrypt:"
    echo "               IPv4 addresses, .local names, split-DNS/internal hostnames, and local domains."
    echo "  ${CYAN}letsencrypt${RESET} For a real public FQDN that resolves publicly to this server and can pass ACME on ports 80/443."
    echo "  ${CYAN}custom${RESET}      For an existing certificate/key pair, including a corporate or internal CA."
    echo ""
    echo "  All SSL modes terminate TLS at Traefik on port 443. --domain accepts a plain hostname,"
    echo "  FQDN, or IPv4 address where supported. host:port and IPv6 literals are not supported."
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
    parse_global_flags "$@"
    set -- "${PARSED_GLOBAL_ARGS[@]}"

    case "$command" in
        install)  cmd_install "$@" ;;
        up)       cmd_up "$@" ;;
        down)     cmd_down "$@" ;;
        status)   cmd_status "$@" ;;
        logs)     cmd_logs "$@" ;;
        upgrade)  cmd_upgrade "$@" ;;
        update)   cmd_upgrade "$@" ;;  # backwards-compatible alias
        ip)       cmd_ip "$@" ;;
        doctor)   cmd_doctor "$@" ;;
        help|-h|--help) cmd_help ;;
        *)
            error "Unknown command: $command"
            cmd_help
            exit 1
            ;;
    esac
}

main "$@"
