# shellcheck shell=bash
# Public/self-hosted migration command. Reuses the shared migrate engine with
# public deploy adapters for logging, compose, Zitadel bootstrap, and FM image
# application.

# shellcheck source=/dev/null
source "$DEPLOY_DIR/scripts/common/migrate.sh"

cmd_migrate() {
    _public_migrate_parse_args "$@" || return 1
    enable_debug_mode
    load_state_env
    load_deploy_meta
    load_deploy_env_overrides

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

mg_step_fm_rebuild() {
    mg_prepare_fleet_db_for_app_boot || return 1
    generate_fm_config "${ZITADEL_HOSTNAME:-${DEPLOY_HOSTNAME:-localhost}}" || return 1
    compose_cmd pull fleet-manager >/dev/null 2>&1 || true
    compose_cmd up -d --no-deps fleet-manager >/dev/null || return 1
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
