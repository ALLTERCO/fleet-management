# shellcheck shell=bash
# Node-RED data volume backup + restore for public installs.
# flows_cred.json needs FM_NODE_RED_CREDENTIAL_SECRET from deploy/state:
# keep a backup-state archive next to these.

cmd_backup_nodered() {
    _backup_nodered_parse_args "$@" || return 1
    [ "$NR_SHOW_HELP" = "true" ] && { _backup_nodered_help; return 0; }
    load_state_env
    load_deploy_meta
    public_nodered_backup "$NR_LABEL"
}

cmd_restore_nodered() {
    _restore_nodered_parse_args "$@" || return 1
    [ "$NR_SHOW_HELP" = "true" ] && { _restore_nodered_help; return 0; }
    [ -n "$NR_RESTORE_PATH" ] || {
        error "restore-nodered requires --path <nodered-*.tar.gz>"
        return 1
    }
    [ "$NR_RESTORE_CONFIRMED" = "true" ] || {
        error "Refusing Node-RED restore without --yes. This replaces all flows, credentials and context."
        return 1
    }
    load_state_env
    load_deploy_meta
    public_nodered_restore "$NR_RESTORE_PATH"
}

# Sets NR_LABEL and NR_SHOW_HELP.
_backup_nodered_parse_args() {
    NR_LABEL="manual"
    NR_SHOW_HELP=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --label)   NR_LABEL="${2:?--label requires a value}"; shift 2 ;;
            --help|-h) NR_SHOW_HELP=true; shift ;;
            *)         error "Unknown backup-nodered flag: $1"; return 1 ;;
        esac
    done
}

# Sets NR_RESTORE_PATH, NR_RESTORE_CONFIRMED and NR_SHOW_HELP.
_restore_nodered_parse_args() {
    NR_RESTORE_PATH=""
    NR_RESTORE_CONFIRMED=false
    NR_SHOW_HELP=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --path)        NR_RESTORE_PATH="${2:?--path requires a value}"; shift 2 ;;
            --yes|--force) NR_RESTORE_CONFIRMED=true; shift ;;
            --help|-h)     NR_SHOW_HELP=true; shift ;;
            *)             error "Unknown restore-nodered flag: $1"; return 1 ;;
        esac
    done
}

_backup_nodered_help() {
    cat <<'EOF_HELP'
Usage: deploy-public.sh backup-nodered [--label NAME]

  Saves the Node-RED data volume (flows, encrypted credentials, context,
  settings) to deploy/state/backups/nodered/. Node-RED stops for a moment so
  its context is flushed. Installed modules are left out; they reinstall.

  The credentials can only be read with FM_NODE_RED_CREDENTIAL_SECRET from
  deploy/state. Back that up too:  deploy-public.sh backup-state --passphrase
EOF_HELP
}

_restore_nodered_help() {
    cat <<'EOF_HELP'
Usage: deploy-public.sh restore-nodered --path FILE --yes

  Replaces the Node-RED data volume with a backup-nodered archive, then
  restarts Node-RED. Refused when the credential secret in deploy/state
  differs from the one used at backup time (restore deploy/state first, or
  set NRBK_ALLOW_SECRET_MISMATCH=1 to drop the saved credentials).
  --force is accepted as --yes.
EOF_HELP
}
