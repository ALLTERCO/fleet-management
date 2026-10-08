# shellcheck shell=bash
# Public/self-hosted migration command. Reuses the shared migrate engine with
# public deploy adapters for logging, compose, Zitadel bootstrap, and FM image
# application.

# shellcheck source=/dev/null
source "$DEPLOY_DIR/scripts/common/migrate.sh"

mg_kdf_salt_preflight() {
    public_kdf_salt_preflight
}

cmd_migrate() {
    _public_migrate_parse_args "$@" || return 1
    enable_debug_mode
    load_state_env
    load_deploy_meta
    load_deploy_env_overrides
    # Migrate recreates Traefik, which reads the TLS key through its group.
    public_tls_key_group_readable || return 1

    ENV_NAME="${DEPLOY_ENV:-public}"
    export ENV_NAME
    export BACKUP_DIR="${BACKUP_DIR:-$STATE_DIR/backups}"
    export UPDATE_HISTORY_LOG="${UPDATE_HISTORY_LOG:-$STATE_DIR/update-history.log}"
    export MIGRATE_LOCK_FILE="${MIGRATE_LOCK_FILE:-$STATE_DIR/migrate.lock}"
    export MIGRATION_REPORT_DIR="${MIGRATION_REPORT_DIR:-$STATE_DIR/migration-reports}"
    export MIGRATION_INVENTORY_DIR="${MIGRATION_INVENTORY_DIR:-$STATE_DIR/migration-inventory}"
    export UPGRADE_AUDIT_DIR="${UPGRADE_AUDIT_DIR:-$STATE_DIR/upgrade-audits}"

    cmd_migrate_engine
}

_public_migrate_parse_args() {
    MIGRATE_PLAN_ONLY=false
    MIGRATE_DRY_RUN=false
    MIGRATE_YES=false
    MIGRATE_VERIFY_RESTORE="${MIGRATE_VERIFY_RESTORE:-auto}"

    local -a runtime_args=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --plan-only)
                MIGRATE_PLAN_ONLY=true
                shift
                ;;
            --dry-run)
                MIGRATE_DRY_RUN=true
                shift
                ;;
            --yes)
                MIGRATE_YES=true
                shift
                ;;
            --verify-restore)
                [ $# -ge 2 ] || { error "--verify-restore requires auto|strict|off"; return 1; }
                MIGRATE_VERIFY_RESTORE="$2"
                shift 2
                ;;
            *)
                runtime_args+=("$1")
                shift
                ;;
        esac
    done

    parse_runtime_flags "${runtime_args[@]}" || return 1
    export MIGRATE_PLAN_ONLY MIGRATE_DRY_RUN MIGRATE_YES MIGRATE_VERIFY_RESTORE
}

# Called by the migrate engine after a successful run. Migrate can replace
# Fleet Manager, so `rollback` must return to the image that ran before it and
# restore the Fleet database dump migrate took before its first step.
# shellcheck disable=SC2329  # Called indirectly by common/migrate.sh.
mg_on_migration_success() {
    local report="$1" snapshot dump fm_container
    [ -n "${MG_ROLLBACK_FM_IMAGE_ID:-}" ] || return 0
    snapshot="$(jq -r '.artifacts.backups.fleet.path // empty' "$report")"
    dump="$(awk -F'\t' -v db="${POSTGRES_DB:-fleet}" '$1 == db { print $3; exit }' \
        "$snapshot/databases.txt" 2>/dev/null || true)"
    if [ -z "$dump" ] || [ ! -s "$dump" ]; then
        error "Migration report $report names no pre-migration dump of ${POSTGRES_DB:-fleet}"
        return 1
    fi
    public_tag_rollback_image "$MG_ROLLBACK_FM_IMAGE_ID" || return 1
    fm_container="$(compat_service_container_id "$COMPOSE_PROJECT_NAME" fleet-manager)"
    public_record_rollback_point "$MG_ROLLBACK_FM_IMAGE_REF" \
        "$(compat_container_image "$fm_container")" "$dump"
}

log_info() { info "$@"; }
log_warn() { warn "$@"; }
log_error() { error "$@"; }

compute_fm_url() {
    if [ "${WITH_SSL:-false}" = "true" ]; then
        printf 'https://%s' "${SSL_DOMAIN:-${DEPLOY_HOSTNAME:-localhost}}"
        return 0
    fi
    printf 'http://localhost:%s' "${FLEET_MANAGER_PORT:-7011}"
}

# Public compose names the image by FM_VERSION, so select the recorded tag.
mg_start_fm_at_image() {
    local image_ref="$1"
    public_resolve_build_identity "${image_ref##*:}"
    FM_VERSION="${image_ref##*:}" \
        compose_cmd up -d --no-deps --no-build --force-recreate fleet-manager >/dev/null || return 1
    public_kdf_salt_confirm_container
}

mg_step_fm_rebuild() {
    mg_prepare_fleet_db_for_app_boot || return 1
    generate_fm_config "${ZITADEL_HOSTNAME:-${DEPLOY_HOSTNAME:-localhost}}" || return 1
    compose_cmd pull fleet-manager >/dev/null 2>&1 || true
    public_resolve_build_identity "${FM_VERSION:-latest}"
    compose_cmd up -d --no-deps fleet-manager >/dev/null || return 1
    public_kdf_salt_confirm_container
}

mg_zitadel_wait_and_setup() {
    local timeout="$1"
    wait_for_zitadel "http://localhost:8080" "$timeout" || return 1

    local hostname="${ZITADEL_HOSTNAME:-${DEPLOY_HOSTNAME:-localhost}}"
    local host_header="${hostname}:${ZITADEL_EXTERNALPORT:-9090}"
    if [ "${ZITADEL_EXTERNALSECURE:-false}" = "true" ]; then
        host_header="${host_header%:443}"
    else
        host_header="${host_header%:80}"
    fi
    zitadel_wait_token_ready "http://localhost:8080" "$host_header" "${ZITADEL_TOKEN_TIMEOUT:-60}" || return 1
    zitadel_wait_management_ready "http://localhost:8080" "$host_header" "${ZITADEL_MGMT_API_TIMEOUT:-60}" || return 1
    wait_for_machinekey "$STATE_DIR/machinekey/zitadel-admin-sa.json" 120 || return 1
    mg_zitadel_wait_machinekey_token_ready \
        "http://localhost:8080" \
        "$host_header" \
        "$STATE_DIR/machinekey/zitadel-admin-sa.json" \
        "${ZITADEL_MACHINEKEY_TOKEN_TIMEOUT:-120}" || return 1
    run_bootstrap "$hostname"
}
