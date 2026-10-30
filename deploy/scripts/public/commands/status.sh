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

    local failed=0
    if ! compose_cmd ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"; then
        error "Could not read Docker Compose service status"
        failed=1
    fi

    echo ""
    local svc_status svc container expected_container display_service
    while IFS= read -r svc; do
        container="$(hc_container_name "$svc")"
        expected_container="$(container_name "$svc")"
        display_service="$svc"
        if [ "$container" != "$expected_container" ]; then
            if [ "$svc" = "zitadel-api" ]; then
                display_service="$svc [shared: $container]"
            else
                display_service="$svc [$container]"
            fi
        fi
        svc_status="$(container_health_status "$container" 2>/dev/null || echo "unknown")"
        if [ "$svc_status" = "healthy" ]; then
            printf "  ${GREEN}✔${RESET}  %-34s %s\n" "$display_service" "${GREEN}${svc_status}${RESET}"
        elif [ "$svc_status" = "running" ]; then
            printf "  ${GREEN}✔${RESET}  %-34s %s\n" "$display_service" "${svc_status}"
        else
            printf "  ${RED}✘${RESET}  %-34s %s\n" "$display_service" "${RED}${svc_status}${RESET}"
            failed=1
        fi
    done < <(_status_services)

    _status_show_deployed
    _status_show_zitadel_actions || failed=1
    echo ""
    return "$failed"
}

# Containers whose health status prints, one per line.
_status_services() {
    # Dev runs Fleet Manager from source, so only the database is a checked container.
    if [ "$FM_DEV_MODE" = "true" ]; then
        printf '%s\n' fleet-db
    else
        printf '%s\n' fleet-manager fleet-db zitadel-api
    fi
    if [ "$WITH_SSL" = "true" ]; then
        printf '%s\n' traefik
    fi
    if [ "${WITH_NODERED:-false}" = "true" ]; then
        printf '%s\n' nodered
    fi
}

# Show what is actually deployed here. A live container is authoritative for
# runtime image/start data; the manifest is retained as deployment metadata and
# is called out explicitly if it disagrees with the running container.
_status_show_deployed() {
    local manifest_file manifest_present=false
    manifest_file="$(manifest_path 2>/dev/null || printf '%s' "$STATE_DIR/contract/manifest.json")"
    [ -f "$manifest_file" ] && manifest_present=true

    local manifest_image="" manifest_db_image="" commit="" digest="" env="" mode="" updated=""
    if [ "$manifest_present" = true ]; then
        manifest_image="$(manifest_get_field '.shared_services.fleet_manager.image' 2>/dev/null || true)"
        manifest_db_image="$(manifest_get_field '.shared_services.fleet_db.image' 2>/dev/null || true)"
        commit="$(manifest_get_field '.identity.build_commit' 2>/dev/null || true)"
        digest="$(manifest_get_field '.shared_services.fleet_manager.image_digest' 2>/dev/null || true)"
        env="$(manifest_get_field '.env' 2>/dev/null || true)"
        mode="$(manifest_get_field '.mode' 2>/dev/null || true)"
        updated="$(manifest_get_field '.shared_services.fleet_manager.last_updated_at' 2>/dev/null || true)"
    fi

    local fleet_container db_container live_image="" live_db_image="" live_started=""
    fleet_container="$(hc_container_name fleet-manager 2>/dev/null || true)"
    db_container="$(hc_container_name fleet-db 2>/dev/null || true)"
    if [ -n "$fleet_container" ]; then
        live_image="$(docker inspect -f '{{.Config.Image}}' "$fleet_container" 2>/dev/null || true)"
        live_started="$(docker inspect -f '{{.State.StartedAt}}' "$fleet_container" 2>/dev/null || true)"
    fi
    if [ -n "$db_container" ]; then
        live_db_image="$(docker inspect -f '{{.Config.Image}}' "$db_container" 2>/dev/null || true)"
    fi

    local image="${live_image:-$manifest_image}"
    local db_image="${live_db_image:-$manifest_db_image}"
    [ -n "$image$db_image$env$mode" ] || return 0

    echo ""
    step "Deployed"
    if [ -n "$image" ]; then
        if [ -n "$live_image" ]; then
            info "Fleet image  ${image} (live: ${fleet_container})"
        else
            info "Fleet image  ${image} (manifest; no live container image available)"
        fi
    fi
    if [ -n "$db_image" ]; then
        if [ -n "$live_db_image" ]; then
            info "DB image     ${db_image} (live: ${db_container})"
        else
            info "DB image     ${db_image} (manifest; no live container image available)"
        fi
    fi
    if [ -n "$live_started" ] && [ "$live_started" != "0001-01-01T00:00:00Z" ]; then
        info "Started      ${live_started}"
    fi
    [ -n "$env" ] && info "Env      ${env}${mode:+ / $mode}"

    if [ -n "$live_image" ] && [ -n "$manifest_image" ] && [ "$live_image" != "$manifest_image" ]; then
        warn "Manifest Fleet image ${manifest_image}${updated:+ recorded $updated} differs from the live container; live runtime shown above is authoritative"
    else
        [ -n "$commit" ] && [ "$commit" != "unknown" ] && info "Commit   ${commit}"
        [ -n "$digest" ] && info "Digest   ${digest}"
        [ -n "$updated" ] && info "Updated  ${updated}"
    fi
    _status_show_db_runtime "$db_image"
}

_status_show_db_runtime() {
    local db_image="$1"
    local container db_user db_name pg_version ts_actual ts_expected ts_status
    container="$(hc_container_name fleet-db 2>/dev/null || true)"
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

_status_show_zitadel_actions() {
    [ "$FM_DEV_MODE" != "true" ] || return 0
    [ -f "$STATE_DIR/machinekey/zitadel-admin-sa.json" ] || return 0
    [ -f "$STATE_DIR/zitadel.env" ] || return 0

    echo ""
    step "Zitadel Action Hooks"

    local host_header="${ZITADEL_HOSTNAME:-localhost}:${ZITADEL_EXTERNALPORT:-9090}"
    if [ "${ZITADEL_EXTERNALSECURE:-false}" = "true" ]; then
        host_header="${host_header%:443}"
    else
        host_header="${host_header%:80}"
    fi

    if ZITADEL_URL="${ZITADEL_URL:-http://localhost:8080}" \
       ZITADEL_HOST_HEADER="$host_header" \
       MACHINEKEY_PATH="$STATE_DIR/machinekey/zitadel-admin-sa.json" \
       STATE_FILE="$STATE_DIR/zitadel.env" \
       FM_RUNTIME_ENV_FILE="$STATE_DIR/fm-runtime.env" \
         bash "$DEPLOY_DIR/scripts/common/check-zitadel-actions.sh"; then
        info "Status ok"
        return 0
    else
        error "Status failed"
        return 1
    fi
}
