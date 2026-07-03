# shellcheck shell=bash
# DB backup operator commands for public/self-hosted installs.

cmd_backup_db() {
    local action="${1:-list}"
    shift || true

    load_state_env
    load_deploy_meta
    export BACKUP_DIR="${BACKUP_DIR:-$STATE_DIR/backups}"

    case "$action" in
        list)    _backup_db_list "$@" ;;
        inspect) _backup_db_inspect "$@" ;;
        verify)  _backup_db_verify "$@" ;;
        create)  _backup_db_create "$@" ;;
        restore) _backup_db_restore "$@" ;;
        --help|-h|help) _backup_db_help ;;
        *)
            error "Unknown backup-db action: $action"
            _backup_db_help
            return 1
            ;;
    esac
}

_backup_db_list() {
    [ $# -eq 0 ] || { error "backup-db list takes no arguments"; return 1; }
    bk_list_backups
}

_backup_db_inspect() {
    local path="${1:-}"
    [ -n "$path" ] || { error "backup-db inspect requires a backup path"; return 1; }
    bk_inspect_backup "$path"
}

_backup_db_verify() {
    local path="${1:-}"
    [ -n "$path" ] || { error "backup-db verify requires a backup path"; return 1; }
    if bk_verify_backup "$path"; then
        ok "Backup verified: $path"
        return 0
    fi
    error "Backup verification failed: $path"
    return 1
}

_backup_db_create() {
    local label="manual"
    while [ $# -gt 0 ]; do
        case "$1" in
            --label) label="${2:?--label requires a value}"; shift 2 ;;
            *) error "Unknown backup-db create flag: $1"; return 1 ;;
        esac
    done

    local from_image backup_path
    from_image="$(upd_current_image_tag)"
    backup_path="$(bk_create_update_backup \
        fleet-db "${POSTGRES_DB:-fleet}" "${POSTGRES_USER:-postgres}" \
        "$from_image" "$from_image" "$label")" || {
            error "Backup failed"
            return 1
        }
    ok "Backup created: $backup_path"
    info "Manifest: $(bk_manifest_path "$backup_path")"
}

_backup_db_restore() {
    local path="" yes=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --yes) yes=1; shift ;;
            *) path="$1"; shift ;;
        esac
    done
    [ -n "$path" ] || { error "backup-db restore requires a backup path"; return 1; }
    [ "$yes" = "1" ] || {
        error "Refusing DB restore without --yes. This stops FM and replaces ${POSTGRES_DB:-fleet}."
        return 1
    }

    info "Stopping Fleet Manager before DB restore..."
    compose_cmd stop fleet-manager >/dev/null 2>&1 || true
    info "Restoring DB from $path..."
    if ! bk_restore fleet-db "${POSTGRES_DB:-fleet}" "${POSTGRES_USER:-postgres}" "$path"; then
        error "DB restore failed"
        return 1
    fi
    info "Starting Fleet Manager..."
    compose_cmd up -d --no-deps fleet-manager >/dev/null
    hc_wait_or_dump fleet-manager "${FM_STARTUP_TIMEOUT:-180}"
}

_backup_db_help() {
    cat <<'EOF'
Usage: deploy-public.sh backup-db <list|inspect|verify|create|restore>

  list                         Print backup inventory as JSON lines
  inspect PATH                 Print a backup manifest, or legacy metadata
  verify PATH                  Verify gzip integrity + manifest checksum
  create [--label NAME]        Create a manual Fleet DB backup
  restore PATH --yes           Stop FM, restore Fleet DB, start FM, health-gate

State credentials are not included here. Use backup-state for deploy/state/.
EOF
}
