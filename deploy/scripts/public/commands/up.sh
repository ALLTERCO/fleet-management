# shellcheck shell=bash

# DB-truth: is the Zitadel event store present? A stale state/zitadel.env can
# outlive a wiped volume, and start-from-setup on an empty DB fails. Any one
# marker table (events/events2 across versions, or projection/system) counts.
zitadel_db_initialized() {
    local c
    c="$(container_name zitadel-db)"
    container_exists "$c" || return 1
    [ "$(docker exec "$c" psql -U postgres -d zitadel -tAc \
          "SELECT (to_regclass('eventstore.events') IS NOT NULL
                OR to_regclass('eventstore.events2') IS NOT NULL
                OR to_regclass('projections.current_states') IS NOT NULL
                OR to_regclass('system.instances') IS NOT NULL);" \
          2>/dev/null | tr -d '[:space:]')" = "t" ]
}

cmd_up() {
    parse_runtime_flags "$@" || return 1
    load_deploy_env_overrides || return 1
    enable_debug_mode

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

    # When SSL is active, public HTTPS is always on port 443 (no custom port support).
    # Traefik terminates TLS; backends are plain HTTP on the Docker bridge.
    if [ "$WITH_SSL" = "true" ]; then
        export ZITADEL_EXTERNALPORT=443
        export ZITADEL_EXTERNALSECURE=true
        export ZITADEL_TLS_MODE=external
        export ZITADEL_PUBLIC_SCHEME=https
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
    else
        export ZITADEL_EXTERNALPORT
        export ZITADEL_EXTERNALSECURE=false
        export ZITADEL_TLS_MODE=disabled
        export ZITADEL_PUBLIC_SCHEME=http
    fi

    phase "Phase 2/4 — Configuration"
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
    preserve_legacy_secret_encryption_key || true
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
    save_deploy_meta "$hostname" "up"
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
        local _probe_host="${hostname}:${ZITADEL_EXTERNALPORT}"
        if [ "${ZITADEL_EXTERNALSECURE:-false}" = "true" ]; then
            _probe_host="${_probe_host%:443}"
        else
            _probe_host="${_probe_host%:80}"
        fi

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
            else
                ok "Zitadel already bootstrapped (hostname unchanged)"
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
    if run_quiet "Starting Fleet Manager containers" compose_cmd "${up_args[@]}"; then
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

    # Action V2 webhook — Zitadel-only; quick mode has no OIDC to wire.
    if [ "$FM_DEV_MODE" != "true" ] && run_actions_bootstrap; then
        if generate_fm_config "$hostname"; then
            run_quiet "Restarting Fleet Manager with signing key" \
                compose_cmd up -d fleet-manager || true
        fi
    fi

    phase "Phase 4/4 — Finalization"
    apply_retention_policies
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
