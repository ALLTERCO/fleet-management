# shellcheck shell=bash
backup_acme_certificate() {
    local destination="$1"
    local source="$STATE_DIR/letsencrypt/acme.json"

    if cp "$source" "$destination" 2>/dev/null; then
        chmod 0600 "$destination"
        return 0
    fi

    # Traefik can read the bind-mounted file even when the deployment user
    # cannot. Stream it into a user-owned temporary file before containers stop.
    if compose_cmd exec -T traefik cat /letsencrypt/acme.json \
        >"$destination" 2>/dev/null && [ -s "$destination" ]; then
        chmod 0600 "$destination"
        return 0
    fi

    rm -f "$destination"
    return 1
}

remove_deploy_state() {
    case "$STATE_DIR" in
        ""|"/"|".")
            error "Unsafe deployment state path; refusing to remove it"
            return 1
            ;;
    esac

    if rm -rf -- "$STATE_DIR" 2>/dev/null && [ ! -e "$STATE_DIR" ]; then
        return 0
    fi
    if command -v sudo >/dev/null 2>&1 \
        && sudo -n rm -rf -- "$STATE_DIR" \
        && [ ! -e "$STATE_DIR" ]; then
        return 0
    fi

    error "Cannot remove deployment state at $STATE_DIR"
    return 1
}

restore_acme_certificate() {
    local backup="$1"
    local destination="$STATE_DIR/letsencrypt/acme.json"

    mkdir -p "$STATE_DIR/letsencrypt"
    mv "$backup" "$destination"
    chmod 0600 "$destination"

    # Traefik drops CAP_DAC_OVERRIDE. Its root process therefore needs to own
    # the mode-0600 bind-mounted file; merely being container root is not enough.
    if [ "$(id -u)" -eq 0 ]; then
        chown 0:0 "$destination"
    elif command -v sudo >/dev/null 2>&1; then
        sudo -n chown 0:0 "$destination"
    else
        error "Cannot set secure ownership on restored Let's Encrypt certificate"
        return 1
    fi
}

cmd_down() {
    enable_debug_mode

    local remove_volumes=false
    local skip_confirm=false
    local keep_certs=false
    for arg in "$@"; do
        case "$arg" in
            --volumes|-v) remove_volumes=true ;;
            --yes|-y) skip_confirm=true ;;
            --keep-certs) keep_certs=true ;;
            --volume)
                error "Unknown flag: --volume"
                info "Did you mean --volumes?"
                return 1
                ;;
            *)
                error "Unknown flag for down: $arg"
                info "Supported flags: --volumes, --yes, --keep-certs"
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
            if [ "$keep_certs" = true ]; then
                warn "  - All Docker volumes (Let's Encrypt certs KEPT via --keep-certs)"
            else
                warn "  - TLS certificates (including Let's Encrypt — reissue is rate-limited!)"
                warn "  - All Docker volumes"
                warn "  (pass --keep-certs to preserve acme.json)"
            fi
            echo ""
            printf "  Type 'yes' to confirm: "
            local confirm=""
            read -r confirm
            if [ "$confirm" != "yes" ]; then
                info "Aborted."
                return 0
            fi
        fi
        local acme_backup=""
        if [ "$keep_certs" = true ] && [ -s "$STATE_DIR/letsencrypt/acme.json" ]; then
            # `mktemp -t` differs between GNU/BSD; use explicit template.
            acme_backup="$(mktemp "${TMPDIR:-/tmp}/fm-acme-XXXXXX")"
            if ! backup_acme_certificate "$acme_backup"; then
                error "Cannot preserve Let's Encrypt certificate; refusing to remove data"
                return 1
            fi
        fi
        spinner_start "Stopping and removing data..."
        if run_quiet "Stopping containers and removing volumes" compose_cmd down -v; then
            cleanup_orphan_optional_containers || true
            if ! remove_deploy_state; then
                [ -n "$acme_backup" ] && rm -f "$acme_backup"
                spinner_stop fail "Data removed, but deployment state cleanup failed"
                return 1
            fi
            if [ -n "$acme_backup" ] && [ -s "$acme_backup" ]; then
                if ! restore_acme_certificate "$acme_backup"; then
                    spinner_stop fail "Data removed, but certificate restore failed"
                    return 1
                fi
                spinner_stop ok "Stopped and removed all data (Let's Encrypt cert preserved)"
            else
                spinner_stop ok "Stopped and removed all data (run 'up' for fresh deploy)"
            fi
        else
            [ -n "$acme_backup" ] && rm -f "$acme_backup"
            spinner_stop fail "Failed to stop containers and remove volumes"
            return 1
        fi
    else
        # Removing the container removes the salt evidence; record it first.
        if ! public_kdf_salt_record_before_down; then
            warn "KDF salt not verified; 'up' will refuse to recreate Fleet Manager until the original salt is confirmed"
        fi
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
