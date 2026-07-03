# shellcheck shell=bash
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
        "${DOCKER_HUB_IMAGE}:${FM_VERSION:-?}"
    )
    if [ "$FM_DEV_MODE" != "true" ]; then
        images+=(
            "postgres:${ZITADEL_POSTGRES_VERSION:-?}"
            "ghcr.io/zitadel/zitadel:${ZITADEL_VERSION:-?}"
        )
    fi
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
        [ -f "$STATE_DIR/fm-runtime.env" ] && ok "FM runtime config: fm-runtime.env" || info "No fm-runtime.env (not configured)"
    else
        info "State directory does not exist (will be created on first run)"
    fi

    # 6. JWT key files (only when jwt-profile is active)
    if [ "${FM_OIDC_AUTH_METHOD:-basic}" = "jwt-profile" ] || \
       [ "${FM_ZITADEL_SERVICE_AUTH:-pat}" = "jwt-profile" ]; then
        step "Zitadel JWT keys"
        local jwt_checks=()
        [ "${FM_OIDC_AUTH_METHOD:-basic}" = "jwt-profile" ] && \
            jwt_checks+=("$STATE_DIR/secrets/oidc-introspection-key.json:Introspection")
        [ "${FM_ZITADEL_SERVICE_AUTH:-pat}" = "jwt-profile" ] && \
            jwt_checks+=("$STATE_DIR/secrets/zitadel-service-key.json:Service user")
        for entry in "${jwt_checks[@]}"; do
            local path="${entry%%:*}" label="${entry#*:}"
            if [ ! -f "$path" ]; then
                error "$label key missing: $path (run \`up\` to regenerate)"
                issues=$((issues + 1))
            elif [ ! -r "$path" ]; then
                error "$label key not readable: $path"
                issues=$((issues + 1))
            elif ! jq -e '.keyId and .key' "$path" >/dev/null 2>&1; then
                error "$label key malformed (expected JSON with keyId+key): $path"
                issues=$((issues + 1))
            else
                ok "$label key valid: $path"
            fi
        done
    fi

    # 7. SSL mode
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
