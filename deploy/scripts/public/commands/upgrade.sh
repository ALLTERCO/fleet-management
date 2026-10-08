# shellcheck shell=bash
cmd_upgrade() {
    # Safe upgrade: backup → pull → apply → health → smoke → rollback-on-failure.
    # Flags: --no-backup (dev only), --no-smoke (skip post-update probe),
    # --unsafe (legacy pre-orchestrator behavior, no backup/smoke/rollback),
    # --local (the target image was built on this machine; never pull it).
    local no_backup=0 no_smoke=0 unsafe=0 migrate_first=0 migrate_yes=0 local_image=0
    local migrate_verify_restore="${MIGRATE_VERIFY_RESTORE:-auto}"
    local soak=0
    local pass_args=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --no-backup) no_backup=1 ;;
            --no-smoke)  no_smoke=1 ;;
            --unsafe)    unsafe=1 ;;
            --migrate-first) migrate_first=1 ;;
            --yes)       migrate_yes=1 ;;
            --verify-restore)
                migrate_verify_restore="${2:?--verify-restore requires auto|strict|off}"
                shift ;;
            --soak)      soak="${2:?--soak requires a seconds value}"; shift ;;
            --local)     local_image=1 ;;
            *)           pass_args+=("$1") ;;
        esac
        shift
    done
    parse_runtime_flags "${pass_args[@]}" || return 1
    enable_debug_mode

    echo ""
    step "Upgrading Fleet Management"

    load_deploy_meta
    load_state_env
    public_kdf_salt_preflight || return 1
    # Before migrate or the swap can recreate Traefik on an older 0600 key.
    public_tls_key_group_readable || return 1

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION
    export DOCKER_HUB_IMAGE="${DOCKER_HUB_IMAGE:-shellygroup/fleet-management}"

    # A locally built image has no registry copy, so it must exist before any backup or apply.
    if [ "$local_image" = "1" ]; then
        if [ -z "${FM_VERSION:-}" ] \
            || ! docker image inspect "${DOCKER_HUB_IMAGE}:${FM_VERSION}" >/dev/null 2>&1; then
            error "--local needs FM_VERSION to name an image on this machine: ${DOCKER_HUB_IMAGE}:${FM_VERSION:-<unset>}"
            return 1
        fi
    fi

    if [ "$unsafe" = "1" ]; then
        warn "Running --unsafe upgrade: no backup, no rollback"
        if [ "$local_image" != "1" ] && [ -f "$STATE_DIR/.env" ]; then
            spinner_start "Pulling newer images..."
            if run_quiet "Pulling configured image tags" compose_cmd pull; then
                spinner_stop ok "Images pulled"
            else
                spinner_stop warn "Pull failed — will use local cache"
            fi
        fi
        cmd_up "${pass_args[@]}"
        return $?
    fi

    if [ ! -f "$STATE_DIR/.env" ]; then
        info "No prior deployment — delegating to 'up'"
        cmd_up "${pass_args[@]}"
        return $?
    fi

    # Installs from before the dirs were pre-created can have root-owned ones.
    public_ensure_state_dirs || return 1

    # `rollback` returns to what ran before the whole upgrade, so this is read
    # before --migrate-first can replace Fleet Manager.
    local pre_upgrade_image_id from_image history_before
    pre_upgrade_image_id="$(docker inspect -f '{{.Image}}' "$(hc_container_name fleet-manager)" 2>/dev/null || true)"
    from_image="$(manifest_get_field '.shared_services.fleet_manager.image' 2>/dev/null || true)"
    history_before="$(public_rollback_history_length)" || return 1

    if ! _public_upgrade_guard_migration_drift "$migrate_first" "$migrate_yes" "$migrate_verify_restore"; then
        return 1
    fi

    _public_upgrade_reconcile_redis_acl || return 1
    # The backend default needs no sync; only an operator list waits for the next up.
    nodered_sync_permissions "$ZITADEL_HOSTNAME" \
        || warn "Node-RED permissions not re-applied; run 'up' to apply FM_NODE_RED_PERMISSIONS"

    # Before the new container exists, so a failure leaves the running one alone.
    _public_upgrade_mcp_sign_in || return 1

    # Safe path: orchestrator with injected apply/revert hooks.
    export DB_SERVICE=fleet-db
    export DB_NAME="${POSTGRES_DB:-fleet}"
    export DB_USER="${POSTGRES_USER:-postgres}"
    export FM_SERVICE=fleet-manager
    export FM_HEALTH_URL
    FM_HEALTH_URL="$(_public_upgrade_health_url)" || {
        error "No address to check Fleet Manager after the upgrade (SSL mode ${SSL_MODE:-none}, no domain)"
        return 1
    }
    export UPD_TARGET_TAG="${FM_VERSION:-latest}"
    [ "$no_backup" = "1" ] && export UPD_NO_BACKUP=1
    [ "$no_smoke" = "1" ]  && export UPD_NO_SMOKE=1
    [ "$soak" != "0" ] && export UPDATE_SOAK_SECONDS="$soak"

    # Only the most recent upgrade is restorable; an earlier tag is replaced.
    if [ -n "$pre_upgrade_image_id" ]; then
        public_tag_rollback_image "$pre_upgrade_image_id" || return 1
    fi

    # shellcheck disable=SC2329  # Called indirectly by common/update.sh.
    upd_apply_new_version() {
        local tag="$1"
        local version
        version="$(_public_fm_version_from_image_ref "$tag")" || return 1
        local services=()
        mapfile -t services < <(_public_upgrade_services)
        if [ "$local_image" != "1" ]; then
            FM_VERSION="$version" run_quiet "Pulling configured image tags" compose_cmd pull "${services[@]}" || return 1
        fi
        public_kdf_salt_preflight || return 1
        public_resolve_build_identity "$version"
        public_tls_key_group_readable || return 1
        FM_VERSION="$version" compose_cmd up -d "${services[@]}" || return 1
        public_kdf_salt_confirm_container || return 1
        _public_upgrade_switch_routes
    }
    # The image the update starts from; its tag (e.g. latest) can move with the pull.
    local update_start_image_id
    update_start_image_id="$(docker inspect -f '{{.Image}}' "$(hc_container_name fleet-manager)" 2>/dev/null || true)"

    # shellcheck disable=SC2329  # Called indirectly by common/update.sh.
    upd_revert_version() {
        local tag="$1"
        local version
        version="$(_public_upgrade_revert_version "$tag" "$update_start_image_id")" || return 1
        public_kdf_salt_preflight || return 1
        public_resolve_build_identity "$version"
        FM_VERSION="$version" compose_cmd up -d fleet-manager || return 1
        public_kdf_salt_confirm_container
    }

    if upd_run; then
        # After --migrate-first, the backup migrate took before changing anything.
        local rollback_backup
        rollback_backup="$(public_rollback_backup_since "$history_before")" || return 1
        public_record_rollback_point "${from_image:-}" "${DOCKER_HUB_IMAGE}:${FM_VERSION:-latest}" \
            "${rollback_backup:-${UPD_LAST_BACKUP_PATH:-}}" || return 1
        # The login gets the current Zitadel pin and session cookie secret.
        mg_start_zitadel_login_if_present || {
            error "Zitadel Login UI did not come back healthy; Fleet Manager was upgraded."
            return 1
        }
        # A failed ALTER EXTENSION rolls back, so the verified app stays and the upgrade fails.
        mg_update_timescale_extension_all fleet-db "$DB_USER" || {
            error "TimescaleDB extension update failed; Fleet Manager was upgraded. Fix and rerun upgrade."
            return 1
        }
        return 0
    fi
    return 1
}

# A domain install is probed at its domain. Otherwise the host's own name for
# Fleet: a saved LAN address goes stale when the address changes.
_public_upgrade_health_url() {
    if [ "${WITH_SSL:-false}" = "true" ] && [ "${SSL_MODE:-}" != "selfsigned" ] \
        && [ -n "${SSL_DOMAIN:-}" ]; then
        printf 'https://%s' "$SSL_DOMAIN"
        return 0
    fi
    public_local_fleet_url
}

# Traefik is recreated with Fleet so it runs the current definition and joins
# fleet-edge, the only network where the routes' upstream name exists.
_public_upgrade_services() {
    public_app_services
    if [ "${WITH_SSL:-false}" = "true" ]; then
        printf '%s\n' traefik
    fi
}

# Runs after the new Fleet and the recreated Traefik are up, so new routes
# never point at an older Fleet or an upstream Traefik cannot reach. A
# rollback keeps them: the reverted Fleet uses the same compose networks.
_public_upgrade_switch_routes() {
    [ "${WITH_SSL:-false}" = "true" ] || return 0
    if ! hc_wait_or_dump traefik "${TRAEFIK_STARTUP_TIMEOUT:-60}" 100; then
        error "Traefik did not become healthy after it was recreated"
        return 1
    fi
    write_traefik_routes_for_ssl_mode || return 1
    # Traefik loads the route file a moment later; smoke must not race it.
    wait_for_fleet_route
}

# Upgrade never reruns the bootstrap, so installs from before MCP browser
# sign-in get its Zitadel apps here and the new container gets their ids.
# Fails loud like the other Zitadel steps instead of leaving sign-in off.
_public_upgrade_mcp_sign_in() {
    if [ "${FM_DEV_MODE:-false}" = "true" ] || [ ! -f "$STATE_DIR/zitadel.env" ]; then
        return 0
    fi
    local hostname="${ZITADEL_HOSTNAME:-${DEPLOY_HOSTNAME:-localhost}}"
    sync_mcp_sign_in_apps "$hostname" || return 1
    generate_fm_config "$hostname"
}

# Upgrade replaces only its own services. Every other pinned service that is
# behind goes through migrate, which snapshots both databases, health-gates
# and rolls back. Plain upgrade refuses Zitadel and PostgreSQL major work and
# names the remaining services it leaves on their running versions.
_public_upgrade_guard_migration_drift() {
    local migrate_first="$1" migrate_yes="$2" verify_restore="$3"
    local plan behind
    plan="$(mp_build_plan)"
    behind="$(_public_upgrade_pins_behind "$plan")"
    [ -n "$behind" ] || return 0

    if [ "$migrate_first" = "1" ]; then
        info "Pinned services behind this release:"
        mp_print_plan "$behind"
        info "--migrate-first set; running migrate before upgrade."
        local -a migrate_args=(--verify-restore "$verify_restore")
        [ "$migrate_yes" = "1" ] && migrate_args+=(--yes)
        cmd_migrate "${migrate_args[@]}" || return 1
        return 0
    fi

    if _public_upgrade_plan_requires_migrate "$plan"; then
        warn "This stack has database/Zitadel migration work pending."
        mp_print_plan "$behind"
        error "Refusing plain upgrade because migrate work is required first."
        error "Run: ./deploy/deploy-public.sh migrate --yes"
        error "Or:  ./deploy/deploy-public.sh upgrade --migrate-first --yes"
        return 1
    fi

    warn "Upgrade leaves these pinned services on their running versions:"
    mp_print_plan "$behind"
    warn "Update them, with backups and rollback: ./deploy/deploy-public.sh upgrade --migrate-first --yes"
    return 0
}

# Plan rows upgrade does not apply itself. It recreates its own services and
# Redis, starts the Zitadel login at the current pin and updates the
# TimescaleDB extension after the swap.
_public_upgrade_pins_behind() {
    local plan="$1" applied
    applied=" $(_public_upgrade_services | tr '\n' ' ')redis zitadel-login "
    printf '%s\n' "$plan" | awk -F'\t' -v applied="$applied" '
        $1 == "noop" || $1 == "fm_rebuild" || $1 == "ts_extension_update" { next }
        index(applied, " " $2 " ") { next }
        NF { print }
    '
}

_public_upgrade_plan_requires_migrate() {
    local plan="$1"
    printf '%s\n' "$plan" | awk -F'\t' '
        $1 == "pg_major_dump_restore" || $1 == "zitadel_stage" || $1 == "zitadel_setup" { found = 1 }
        END { exit found ? 0 : 1 }
    '
}

# FM_VERSION that starts exactly the image the update began with. Its own tag
# when that still names it; otherwise the rollback tag, which upgrade sets to
# that image unless --migrate-first replaced Fleet Manager first. Never pulls:
# a pull can move the tag to the image being reverted.
# Usage: _public_upgrade_revert_version <running image ref> <image id>
_public_upgrade_revert_version() {
    local image_ref="$1" image_id="$2" version
    version="$(_public_fm_version_from_image_ref "$image_ref")" || return 1
    if [ -z "$image_id" ] || [ "$(_public_image_id "$version")" = "$image_id" ]; then
        printf '%s' "$version"
        return 0
    fi
    if [ "$(_public_image_id rollback)" = "$image_id" ]; then
        printf 'rollback'
        return 0
    fi
    error "${DOCKER_HUB_IMAGE}:${version} no longer names the image the update started from ($image_id)"
    error "Start that image by hand, then run: ./deploy/deploy-public.sh rollback"
    return 1
}

_public_image_id() {
    docker image inspect -f '{{.Id}}' "${DOCKER_HUB_IMAGE:-shellygroup/fleet-management}:$1" 2>/dev/null || true
}

_public_fm_version_from_image_ref() {
    local image_ref="$1"
    case "$image_ref" in
        *@sha256:*)
            error "Digest-pinned FM rollback is not supported by FM_VERSION tag interpolation yet: $image_ref"
            return 1
            ;;
        *:*)        printf '%s' "${image_ref##*:}" ;;
        *)          printf '%s' "$image_ref" ;;
    esac
}

_public_upgrade_reconcile_redis_acl() {
    generate_passwords
    save_env
    STATE_DIR="$STATE_DIR" \
        REDIS_ADMIN_PASSWORD="$REDIS_ADMIN_PASSWORD" \
        REDIS_FM_PASSWORD="$REDIS_FM_PASSWORD" \
        REDIS_ZITADEL_PASSWORD="$REDIS_ZITADEL_PASSWORD" \
        bash "$DEPLOY_DIR/scripts/common/init-redis-acl.sh" \
            || { error "Failed to render Redis ACL file"; return 1; }
    compose_cmd up -d redis >/dev/null 2>&1 || {
        error "Failed to start Redis for ACL reconciliation"
        return 1
    }
    REDIS_CONTAINER="${REDIS_CONTAINER:-fm-redis}" \
        bash "$DEPLOY_DIR/scripts/common/reload-redis-acl.sh" || {
            error "Failed to reload Redis ACL"
            return 1
        }
}
