# shellcheck shell=bash
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
    local services=(fleet-manager fleet-db)
    if [ "$FM_DEV_MODE" != "true" ]; then
        services+=(zitadel-api)
    fi
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

    _status_show_deployed
    echo ""
}

# Show what is actually deployed here — read straight from the deploy manifest.
_status_show_deployed() {
    local manifest_file
    manifest_file="$(manifest_path 2>/dev/null || printf '%s' "$STATE_DIR/contract/manifest.json")"
    [ -f "$manifest_file" ] || return 0

    local image db_image commit digest env mode updated
    image="$(manifest_get_field '.shared_services.fleet_manager.image')"
    db_image="$(manifest_get_field '.shared_services.fleet_db.image')"
    commit="$(manifest_get_field '.identity.build_commit')"
    digest="$(manifest_get_field '.shared_services.fleet_manager.image_digest')"
    env="$(manifest_get_field '.env')"
    mode="$(manifest_get_field '.mode')"
    updated="$(manifest_get_field '.shared_services.fleet_manager.last_updated_at')"

    echo ""
    step "Deployed"
    [ -n "$image" ] && info "Fleet image  ${image}"
    [ -n "$db_image" ] && info "DB image     ${db_image}"
    [ -n "$commit" ] && [ "$commit" != "unknown" ] && info "Commit   ${commit}"
    [ -n "$digest" ] && info "Digest   ${digest}"
    [ -n "$env" ] && info "Env      ${env}${mode:+ / $mode}"
    [ -n "$updated" ] && info "Updated  ${updated}"
    _status_show_db_runtime "$db_image"
}

_status_show_db_runtime() {
    local db_image="$1"
    local container db_user db_name pg_version ts_actual ts_expected ts_status
    container="$(container_name fleet-db 2>/dev/null || true)"
    db_user="${POSTGRES_USER:-postgres}"
    db_name="${POSTGRES_DB:-fleet}"
    [ -n "$container" ] || return 0

    pg_version="$(compat_postgres_server_version "$container" "$db_user" "$db_name" || true)"
    ts_actual="$(compat_timescale_extension_version "$container" "$db_user" "$db_name" || true)"
    ts_expected="$(compat_timescale_version_from_tag "${db_image#timescale/timescaledb:}" 2>/dev/null || true)"
    ts_status="$(compat_timescale_match_status "$ts_actual" "$ts_expected")"

    echo ""
    step "Database Runtime"
    info "PostgreSQL       ${pg_version:-unavailable}"
    info "Timescale live   ${ts_actual:-unavailable}"
    info "Timescale expect ${ts_expected:-unavailable}"
    info "Match status     ${ts_status}"
}
