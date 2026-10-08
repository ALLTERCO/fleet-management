# shellcheck shell=bash

# Resolve the public zitadel-db container, then delegate the event-store probe
# to the shared helper (deploy/scripts/common/zitadel-state.sh) so the marker
# tables live in one place.
zitadel_db_initialized() {
    local c
    c="$(container_name zitadel-db)"
    container_exists "$c" || return 1
    zitadel_event_store_initialized "$c"
}

dev_server_stop_infrastructure() {
    compose_cmd down
}

# Dev mode is the shared from-source dev server; Fleet Manager never runs in a container.
_public_up_dev() {
    WITH_SSL=false
    SSL_MODE=""

    echo ""
    echo "  ${BOLD}${WHITE}Fleet Manager dev server${RESET}"
    echo ""

    phase "Phase 1/3 — Prerequisites"
    ensure_prereqs_for_up || return 1
    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
        error "Dev mode runs Fleet Manager from source and needs Node.js 24 with npm."
        return 1
    fi
    local node_major
    node_major="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$node_major" != "24" ]; then
        warn "Fleet Manager targets Node.js 24; found $(node -v)."
    fi
    validate_dev_server_ports || return 1

    phase "Phase 2/3 — Configuration"
    load_state_env
    migrate_legacy_secret_encryption_key || return 1
    generate_passwords
    if ! validate_no_demo_literals; then
        error "Demo / weak secret detected. Rotate before continuing."
        return 1
    fi
    save_env
    generate_init_sql

    phase "Phase 3/3 — Database and Redis"
    if run_quiet "Starting database and Redis" compose_cmd up -d fleet-db redis; then
        ok "Database and Redis started"
    else
        error "Failed to start database and Redis"
        return 1
    fi
    if ! hc_wait_or_dump fleet-db 60; then
        error "Database did not become healthy within 60s."
        return 1
    fi
    save_deploy_meta "localhost" "up"

    dev_server_start "$FM_DIR" "$DEPLOY_DIR"
}

cmd_up() {
    parse_runtime_flags "$@" || return 1
    resolve_nodered_choice
    load_deploy_env_overrides || return 1
    enable_debug_mode

    if [ "$FM_DEV_MODE" = "true" ]; then
        _public_up_dev
        return
    fi

    # First run (interactive): ask local-vs-domain instead of requiring flags.
    preflight_choose_mode

    # Default to self-signed SSL — OIDC PKCE needs a secure context.
    if [ "$WITH_SSL" != true ] && [ -z "$SSL_MODE" ]; then
        WITH_SSL=true
        SSL_MODE="selfsigned"
    fi

    echo ""
    echo "  ${BOLD}${WHITE}Fleet Manager${RESET}"
    echo ""

    preflight_check

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
    # Waiting-room org for gate-less devices: domain when given, else code default.
    export FM_DEVICE_INGRESS_DEFAULT_ORGANIZATION_ID="${FM_DEVICE_INGRESS_DEFAULT_ORGANIZATION_ID:-${SSL_DOMAIN:-}}"

    export_zitadel_external_settings
    if [ "$WITH_SSL" = "true" ]; then
        if [ "$SSL_MODE" = "selfsigned" ]; then
            info "SSL enabled — self-signed certificate for $hostname"
        elif [ "$SSL_MODE" = "custom" ]; then
            info "SSL enabled — using custom certificate for $hostname"
        elif [ -s deploy/state/letsencrypt/acme.json ] \
            && grep -q "\"main\":\"$SSL_DOMAIN\"" deploy/state/letsencrypt/acme.json 2>/dev/null; then
            info "SSL enabled — reusing existing Let's Encrypt cert for $SSL_DOMAIN"
        else
            info "SSL enabled — Traefik will provision Let's Encrypt cert for $SSL_DOMAIN"
        fi
    fi

    phase "Phase 2/4 — Configuration"
    public_ensure_state_dirs || return 1
    # Existing state must load before generation/validation so persisted weak
    # values are rejected instead of being hidden by temporary random values.
    load_state_env

    # FM_VAULT_BACKEND=op|vault|aws hydrates state/.env from the configured
    # vault; FM_VAULT_BACKEND=env (or unset) keeps the local-generate path.
    if [ -n "${FM_VAULT_BACKEND:-}" ] && [ "$FM_VAULT_BACKEND" != "env" ]; then
        if [ ! -f "$STATE_DIR/.env" ]; then
            step "Hydrating secrets from vault backend: $FM_VAULT_BACKEND"
            if bash "$DEPLOY_DIR/scripts/common/load-secrets.sh"; then
                ok "Secrets loaded from $FM_VAULT_BACKEND"
                load_state_env
            else
                error "load-secrets.sh failed for backend=$FM_VAULT_BACKEND"
                return 1
            fi
        fi
    fi
    public_kdf_salt_preflight || return 1
    if [ "$WITH_SSL" = "true" ]; then
        edge_network_preflight "${FM_EDGE_SUBNET:-}" \
            "${COMPOSE_PROJECT_NAME:-fleet-public}_fleet-edge" || return 1
    fi
    migrate_legacy_secret_encryption_key
    generate_passwords
    if ! validate_no_demo_literals; then
        error "Demo / weak secret detected. Rotate before continuing."
        return 1
    fi
    if ! validate_bootstrap_admin_passwords "${DEPLOY_ENV:-public}"; then
        error "Weak bootstrap admin password detected. Rotate before continuing."
        return 1
    fi
    save_env
    generate_init_sql
    generate_system_api_keypair
    # docker-compose.zitadel.yml mounts state/redis-users.acl read-only into
    # the Redis container; without this render Redis loads with no ACL and FM
    # auth as fm-default fails with WRONGPASS.
    STATE_DIR="$STATE_DIR" \
        REDIS_ADMIN_PASSWORD="$REDIS_ADMIN_PASSWORD" \
        REDIS_FM_PASSWORD="$REDIS_FM_PASSWORD" \
        REDIS_ZITADEL_PASSWORD="$REDIS_ZITADEL_PASSWORD" \
        bash "$DEPLOY_DIR/scripts/common/init-redis-acl.sh" \
            || { error "Failed to render Redis ACL file"; return 1; }

    # Generate TLS certs and Traefik routing config
    if [ "$WITH_SSL" = "true" ]; then
        case "$SSL_MODE" in
            selfsigned) generate_selfsigned_cert "$hostname" ;;
            custom) install_custom_cert ;;
        esac
        write_traefik_routes_for_ssl_mode || return 1
    fi

    # The machinekey dir holds the Zitadel admin private key, so it must not be
    # world-readable/writable. Give it to the Zitadel container's UID (1000) at
    # 0770 instead — same pattern as the private installer.
    if [ "$FM_DEV_MODE" != "true" ]; then
        mkdir -p "$STATE_DIR/machinekey"
        dir_owner=$(stat -c '%u' "$STATE_DIR/machinekey" 2>/dev/null \
            || stat -f '%u' "$STATE_DIR/machinekey" 2>/dev/null \
            || echo "")
        if [ "$dir_owner" != "1000" ]; then
            chmod 0770 "$STATE_DIR/machinekey"
            if [ "$(uname -s)" = "Darwin" ]; then
                log_info "Docker Desktop will mediate machinekey bind-mount ownership on macOS."
            else
                sudo chown "1000:$(id -g)" "$STATE_DIR/machinekey"
            fi
        fi
    fi

    # Pre-create so FM's read-only mount gets our dir, not a root-owned auto-created one.
    # 0755 so the container's node user can traverse in to read the 0644 manifest.
    mkdir -p "$STATE_DIR/contract"
    chmod 0755 "$STATE_DIR/contract"

    phase "Phase 3/4 — Containers"
    verify_images
    # Before Compose creates containers, so every label records the image's commit.
    public_resolve_build_identity "${FM_VERSION:-latest}"

    local db_services=(fleet-db)
    [ "$FM_DEV_MODE" != "true" ] && db_services+=(zitadel-db redis)
    if [ "$FM_DEV_MODE" != "true" ]; then
        compat_backup_zitadel_db_if_running \
            "$DEPLOY_DIR/scripts/common/backup-zitadel.sh" \
            "$STATE_DIR" \
            "${COMPOSE_PROJECT_NAME:-fleet-public}" || {
                error "Pre-upgrade Zitadel backup failed; refusing to continue."
                return 1
            }
        compat_refuse_postgres_major_change \
            "${COMPOSE_PROJECT_NAME:-fleet-public}" \
            fleet-db \
            "${TIMESCALEDB_VERSION:-}" \
            "Fleet DB" || return 1
        compat_refuse_postgres_major_change \
            "${COMPOSE_PROJECT_NAME:-fleet-public}" \
            zitadel-db \
            "${ZITADEL_POSTGRES_VERSION:-}" \
            "Zitadel DB" || return 1
    fi
    if run_quiet "Starting database containers" compose_cmd up -d "${db_services[@]}"; then
        ok "Databases started"
    else
        error "Failed to start database containers"
        return 1
    fi
    if [ "$FM_DEV_MODE" != "true" ]; then
        REDIS_CONTAINER="${REDIS_CONTAINER:-fm-redis}" \
            bash "$DEPLOY_DIR/scripts/common/reload-redis-acl.sh" || {
                error "Failed to reload Redis ACL"
                return 1
            }
    fi

    if [ "$FM_DEV_MODE" = "true" ]; then
        export FM_DEV_MODE=true
        info "Quick mode — skipping Zitadel, FM_DEV_MODE=true exported for FM container"
    else

        if zitadel_db_initialized; then
            export ZITADEL_START_PHASE="start-from-setup --init-projections=true"
            info "Existing Zitadel event store detected — using start-from-setup."
        else
            unset ZITADEL_START_PHASE
        fi
        compat_remove_legacy_zitadel_container "${COMPOSE_PROJECT_NAME:-fleet-public}"
        if run_quiet "Starting Zitadel container" compose_cmd up -d zitadel-api; then
            ok "Zitadel started"
        else
            error "Failed to start Zitadel container"
            return 1
        fi

        # Step 3: Wait for Zitadel health
        wait_for_zitadel "http://localhost:8080" "${ZITADEL_STARTUP_TIMEOUT:-180}"

        # Zitadel routes by Host — strip default ports for exact match.
        local _probe_host
        _probe_host="$(zitadel_host_header "${hostname}:${ZITADEL_EXTERNALPORT}" "${ZITADEL_EXTERNALSECURE:-false}")"

        # Step 3b: token endpoint — /debug/ready passes before OIDC is wired.
        if ! zitadel_wait_token_ready "http://localhost:8080" "$_probe_host" "${ZITADEL_TOKEN_TIMEOUT:-60}"; then
            error "Check logs: ./deploy/deploy-public.sh logs zitadel-api"
            return 1
        fi

        # Step 3c: management API — HTTP can answer before internal gRPC binds;
        # bootstrap POSTs would hit `code:14 dial tcp [::1]:8080 refused` otherwise.
        if ! zitadel_wait_management_ready "http://localhost:8080" "$_probe_host" "${ZITADEL_MGMT_API_TIMEOUT:-60}"; then
            error "Check logs: ./deploy/deploy-public.sh logs zitadel-api"
            return 1
        fi

        # Bootstrap (idempotent). The state file marks a completed FM bootstrap;
        # the event store exists earlier. Bootstrap when the DB is empty or the
        # file is missing; skip only when both exist and the hostname is unchanged.
        if ! zitadel_db_initialized || [ ! -f "$STATE_DIR/zitadel.env" ]; then
            run_bootstrap "$hostname" || return 1
        else
            # Only re-run if hostname changed (updates redirect URIs)
            local prev_hostname=""
            prev_hostname=$(sed -n 's|^ZITADEL_ISSUER_URL=https\{0,1\}://\([^:/]*\).*|\1|p' "$STATE_DIR/zitadel.env" 2>/dev/null || true)
            if [ "$prev_hostname" != "$hostname" ]; then
                info "Hostname changed ($prev_hostname -> $hostname), re-running bootstrap"
                run_bootstrap "$hostname" || return 1
            elif nodered_identity_missing; then
                info "Node-RED turned on, re-running bootstrap for its service account"
                run_bootstrap "$hostname" || return 1
            else
                ok "Zitadel already bootstrapped (hostname unchanged)"
                nodered_sync_permissions "$hostname" || return 1
                sync_mcp_sign_in_apps "$hostname" || return 1
            fi
        fi

        generate_fm_config "$hostname" || return 1

    fi  # end: FM_DEV_MODE conditional (Zitadel + OIDC bootstrap)

    # Quick mode must run without OIDC. A leftover fm-runtime.env from a prior
    # non-quick deploy would otherwise feed real OIDC env vars into the FM
    # container (via the compose env_file directive) and suppress DEV_MODE.
    if [ "$FM_DEV_MODE" = "true" ] && [ -f "$STATE_DIR/fm-runtime.env" ]; then
        rm -f "$STATE_DIR/fm-runtime.env"
        info "Cleared leftover fm-runtime.env (quick mode runs without OIDC)"
    fi

    # Quick mode sweeps orphaned Zitadel/Traefik containers from a prior
    # full-mode deploy — compose ignores them otherwise.
    local up_args=(up -d)
    [ "$FM_DEV_MODE" = "true" ] && up_args+=(--remove-orphans)
    public_kdf_salt_preflight || return 1
    save_deploy_meta "$hostname" "up"
    cleanup_orphan_optional_containers nodered || true
    if run_quiet "Starting Fleet Manager containers" compose_cmd "${up_args[@]}"; then
        ok "All services started"
    else
        error "Failed to start Fleet Manager containers"
        return 1
    fi
    public_kdf_salt_confirm_container || return 1

    if [ "$WITH_SSL" != "true" ]; then
        local actual_port
        actual_port=$(docker port "$(container_name fleet-manager)" 7011 2>/dev/null | head -1 || true)
        debug "FM port mapping: ${actual_port:-unknown} (expected 0.0.0.0:${FLEET_MANAGER_PORT})"
    fi

    # Stream FM logs while we wait for healthcheck. Default = WARN/ERROR/FATAL
    # only (silent on a clean boot, surfaces real problems if anything trips).
    # DEBUG_MODE = full raw logs for diagnostics.
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
    else
        docker logs -f "$(container_name fleet-manager)" 2>&1 \
            | grep --line-buffered -E "WARN|ERROR|FATAL" \
            | sed 's/^/    /' &
        sed_pid=$!
    fi

    spinner_start "Fleet Manager starting..."
    local fm_timeout="${FM_STARTUP_TIMEOUT:-180}"
    if hc_wait_or_dump fleet-manager "$fm_timeout"; then
        kill_log_tail
        spinner_stop ok "Fleet Manager ready"
    else
        kill_log_tail
        spinner_stop fail "Fleet Manager did not start within ${fm_timeout}s"
        return 1
    fi

    if [ "$WITH_SSL" = "true" ]; then
        spinner_start "Traefik starting..."
        if hc_wait_or_dump traefik "${TRAEFIK_STARTUP_TIMEOUT:-60}" 100; then
            spinner_stop ok "Traefik ready"
        else
            spinner_stop fail "Traefik did not become healthy"
            return 1
        fi
    fi

    if nodered_enabled; then
        spinner_start "Node-RED starting..."
        if hc_wait_or_dump nodered 240 100; then
            spinner_stop ok "Node-RED ready"
        else
            spinner_stop fail "Node-RED did not become healthy"
            return 1
        fi
    fi

    # Action V2 webhook — Zitadel-only; quick mode has no OIDC to wire.
    if [ "$FM_DEV_MODE" != "true" ]; then
        run_actions_bootstrap "$hostname" || return 1
        if generate_fm_config "$hostname"; then
            verify_actions_runtime_config "$hostname" || return 1
            public_kdf_salt_preflight || return 1
            run_quiet "Restarting Fleet Manager with signing key" \
                compose_cmd up -d fleet-manager || return 1
            if ! hc_wait_or_dump fleet-manager "${FM_STARTUP_TIMEOUT:-180}"; then
                error "Fleet Manager did not become healthy after the signing key restart"
                return 1
            fi
        fi
    fi
    wait_for_fleet_route || return 1

    phase "Phase 4/4 — Finalization"
    apply_retention_policies || return 1
    _public_capture_build_identity
    manifest_record_install

    # Print summary
    print_summary "$hostname"
    preflight_confirm_ui
}

# The community image bakes its commit (org.opencontainers.image.revision) and
# is pulled by digest. Read both from the running container so the manifest can
# pin exactly what runs — otherwise public installs record commit "unknown" and
# no digest.
_public_capture_build_identity() {
    local container image_id
    container="$(hc_container_name fleet-manager)"
    if [ -z "${FM_BUILD_COMMIT:-}" ]; then
        FM_BUILD_COMMIT="$(docker inspect \
            --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
            "$container" 2>/dev/null || true)"
        export FM_BUILD_COMMIT
    fi
    image_id="$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || true)"
    [ -n "$image_id" ] || return 0
    FM_IMAGE_DIGEST="$(docker inspect \
        --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' \
        "$image_id" 2>/dev/null || true)"
    export FM_IMAGE_DIGEST
}
