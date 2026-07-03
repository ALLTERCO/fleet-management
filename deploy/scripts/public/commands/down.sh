# shellcheck shell=bash
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
            cp "$STATE_DIR/letsencrypt/acme.json" "$acme_backup"
            chmod 0600 "$acme_backup"
        fi
        spinner_start "Stopping and removing data..."
        if run_quiet "Stopping containers and removing volumes" compose_cmd down -v; then
            cleanup_orphan_optional_containers || true
            rm -rf "$STATE_DIR"
            if [ -n "$acme_backup" ] && [ -s "$acme_backup" ]; then
                mkdir -p "$STATE_DIR/letsencrypt"
                mv "$acme_backup" "$STATE_DIR/letsencrypt/acme.json"
                chmod 0600 "$STATE_DIR/letsencrypt/acme.json"
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
