# shellcheck shell=bash
cmd_upgrade() {
    # Safe upgrade: backup → pull → apply → health → smoke → rollback-on-failure.
    # Flags: --no-backup (dev only), --no-smoke (skip post-update probe),
    # --unsafe (legacy pre-orchestrator behavior, no backup/smoke/rollback).
    local no_backup=0 no_smoke=0 unsafe=0 migrate_first=0 migrate_yes=0
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
            *)           pass_args+=("$1") ;;
        esac
        shift
    done
    parse_runtime_flags "${pass_args[@]}" || return 1
    enable_debug_mode

    echo ""
    step "Upgrading Fleet Management"

    load_state_env
    load_deploy_meta

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION
    export DOCKER_HUB_IMAGE="${DOCKER_HUB_IMAGE:-shellygroup/fleet-management}"

    if [ "$unsafe" = "1" ]; then
        warn "Running --unsafe upgrade: no backup, no rollback"
        if [ -f "$STATE_DIR/.env" ]; then
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

    if ! _public_upgrade_guard_migration_drift "$migrate_first" "$migrate_yes" "$migrate_verify_restore"; then
        return 1
    fi

    _public_upgrade_reconcile_redis_acl || return 1

    # Safe path: orchestrator with injected apply/revert hooks.
    export DB_SERVICE=fleet-db
    export DB_NAME="${POSTGRES_DB:-fleet}"
    export DB_USER="${POSTGRES_USER:-postgres}"
    export FM_SERVICE=fleet-manager
    export FM_HEALTH_URL
    if [ "${WITH_SSL:-false}" = "true" ] && [ -n "${SSL_DOMAIN:-}" ]; then
        FM_HEALTH_URL="https://$SSL_DOMAIN"
    else
        FM_HEALTH_URL="http://localhost:${FLEET_MANAGER_PORT:-7011}"
    fi
    export UPD_TARGET_TAG="${FM_VERSION:-latest}"
    [ "$no_backup" = "1" ] && export UPD_NO_BACKUP=1
    [ "$no_smoke" = "1" ]  && export UPD_NO_SMOKE=1
    [ "$soak" != "0" ] && export UPDATE_SOAK_SECONDS="$soak"

    # Tag current image as fleet-manager:rollback so a later explicit
    # `rollback` command can revert. Pre-existing-but-failed tags are
    # overwritten — only the most recent successful upgrade is restorable.
    local current_id
    current_id="$(docker inspect -f '{{.Image}}' "$(hc_container_name fleet-manager)" 2>/dev/null || true)"
    [ -n "$current_id" ] && docker tag "$current_id" "${DOCKER_HUB_IMAGE}:rollback" 2>/dev/null || true

    local from_image
    from_image="$(manifest_get_field '.shared_services.fleet_manager.image' 2>/dev/null || true)"

    # shellcheck disable=SC2329  # Called indirectly by common/update.sh.
    upd_apply_new_version() {
        local tag="$1"
        local version
        version="$(_public_fm_version_from_image_ref "$tag")" || return 1
        FM_VERSION="$version" run_quiet "Pulling configured image tags" compose_cmd pull fleet-manager || return 1
        FM_VERSION="$version" compose_cmd up -d fleet-manager
    }
    # shellcheck disable=SC2329  # Called indirectly by common/update.sh.
    upd_revert_version() {
        local tag="$1"
        local version
        version="$(_public_fm_version_from_image_ref "$tag")" || return 1
        # Pull in case the image was pruned between update and rollback.
        FM_VERSION="$version" compose_cmd pull fleet-manager >/dev/null 2>&1 || true
        FM_VERSION="$version" compose_cmd up -d fleet-manager
    }

    if upd_run; then
        UPDATE_FROM_IMAGE="${from_image:-}" \
        UPDATE_TO_IMAGE="${DOCKER_HUB_IMAGE}:${FM_VERSION:-latest}" \
        UPDATE_BACKUP_PATH="${UPD_LAST_BACKUP_PATH:-}" \
        UPDATE_BACKUP_MANIFEST_PATH="${UPD_LAST_BACKUP_MANIFEST_PATH:-}" \
            manifest_record_public_update
        return 0
    fi
    return 1
}

_public_upgrade_guard_migration_drift() {
    local migrate_first="$1" migrate_yes="$2" verify_restore="$3"
    local plan
    plan="$(mp_build_plan)"
    if ! _public_upgrade_plan_requires_migrate "$plan"; then
        return 0
    fi

    warn "This stack has database/Zitadel migration work pending."
    mp_print_plan "$plan"

    if [ "$migrate_first" = "1" ]; then
        info "--migrate-first set; running migrate before upgrade."
        local -a migrate_args=(--verify-restore "$verify_restore")
        [ "$migrate_yes" = "1" ] && migrate_args+=(--yes)
        cmd_migrate "${migrate_args[@]}" || return 1
        return 0
    fi

    error "Refusing plain upgrade because migrate work is required first."
    error "Run: ./deploy/deploy-public.sh migrate --yes"
    error "Or:  ./deploy/deploy-public.sh upgrade --migrate-first --yes"
    return 1
}

_public_upgrade_plan_requires_migrate() {
    local plan="$1"
    printf '%s\n' "$plan" | awk -F'\t' '
        $1 == "pg_major_dump_restore" || $1 == "zitadel_stage" || $1 == "zitadel_setup" { found = 1 }
        END { exit found ? 0 : 1 }
    '
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
