#!/usr/bin/env bash
#
# deploy-public.sh — Fleet Management Installer
#
# Fully self-contained installer for the open-source Fleet Management system.
# Downloads and runs Fleet Manager, TimescaleDB, and Zitadel (OIDC auth).
#
# Supports: Ubuntu/Debian, Raspberry Pi (arm64), Arch Linux, macOS
#
# Usage:
#   ./deploy/deploy-public.sh up             Start (idempotent: installs deps, bootstraps or restarts)
#   ./deploy/deploy-public.sh upgrade        Pull newer images, then restart
#   ./deploy/deploy-public.sh down           Stop (keep data)
#   ./deploy/deploy-public.sh down --volumes Stop and delete all data
#   ./deploy/deploy-public.sh status         Show service status
#   ./deploy/deploy-public.sh logs [service] Show logs
#   ./deploy/deploy-public.sh ip             Show access URLs
#   ./deploy/deploy-public.sh doctor         Troubleshoot configuration
#   ./deploy/deploy-public.sh help           Show help
#
# Image pull behavior:
#   'up'      — uses cached images; pulls only if missing (first run)
#   'upgrade' — pulls all images from registry, then runs 'up'
#
# Environment overrides (set before running):
#   FM_VERSION           Fleet Manager version (default: latest)
#   FLEET_MANAGER_PORT   FM port (default: 7011)
#   ZITADEL_EXTERNALPORT Zitadel port (default: 9090)
#   POSTGRES_PASSWORD    TimescaleDB password (default: auto-generated)

set -euo pipefail

# Fail early on macOS's default Bash 3.2 — the deploy scripts use Bash 4+
# features that otherwise crash mid-run with confusing errors.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
    printf 'Fleet Manager needs Bash 4+ (you have %s).\n' "${BASH_VERSION:-unknown}" >&2
    printf 'On macOS: brew install bash, then re-run.\n' >&2
    exit 1
fi

# ── Source library modules ────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/ssl.sh"
source "$SCRIPT_DIR/lib/docker.sh"
source "$SCRIPT_DIR/lib/install.sh"
source "$SCRIPT_DIR/lib/preflight.sh"
source "$SCRIPT_DIR/lib/state.sh"
source "$SCRIPT_DIR/lib/compose.sh"
source "$SCRIPT_DIR/lib/zitadel.sh"
source "$SCRIPT_DIR/../common/healthwait.sh"
source "$SCRIPT_DIR/../common/zitadel-state.sh"
source "$SCRIPT_DIR/../common/zitadel-bringup.sh"
source "$SCRIPT_DIR/../common/backup.sh"
source "$SCRIPT_DIR/../common/smoke.sh"
source "$SCRIPT_DIR/../common/update.sh"
source "$SCRIPT_DIR/../common/compat.sh"
source "$SCRIPT_DIR/../common/migrate-plan.sh"
source "$SCRIPT_DIR/../common/upgrade-audit.sh"
source "$SCRIPT_DIR/../common/manifest.sh"
source "$SCRIPT_DIR/../common/manifest-record.sh"
source "$SCRIPT_DIR/../common/zitadel-smtp.sh"

source "$SCRIPT_DIR/commands/up.sh"
source "$SCRIPT_DIR/commands/down.sh"
source "$SCRIPT_DIR/commands/status.sh"
source "$SCRIPT_DIR/commands/logs.sh"
source "$SCRIPT_DIR/commands/upgrade.sh"
source "$SCRIPT_DIR/commands/migrate.sh"
source "$SCRIPT_DIR/commands/rollback.sh"
source "$SCRIPT_DIR/commands/ip.sh"
source "$SCRIPT_DIR/commands/doctor.sh"
source "$SCRIPT_DIR/commands/rotate-secrets.sh"
source "$SCRIPT_DIR/commands/backup-state.sh"
source "$SCRIPT_DIR/commands/backup-db.sh"
source "$SCRIPT_DIR/commands/upgrade-audit.sh"
source "$SCRIPT_DIR/commands/seed.sh"
source "$SCRIPT_DIR/commands/help.sh"

main() {
    local command="${1:-help}"
    shift || true
    parse_global_flags "$@"
    set -- "${PARSED_GLOBAL_ARGS[@]}"

    case "$command" in
        install)  cmd_install "$@" ;;
        up)       cmd_up "$@" ;;
        down)     cmd_down "$@" ;;
        status)   cmd_status "$@" ;;
        logs)     cmd_logs "$@" ;;
        upgrade)  cmd_upgrade "$@" ;;
        update)   cmd_upgrade "$@" ;;  # backwards-compatible alias
        migrate)  cmd_migrate "$@" ;;
        rollback) cmd_rollback "$@" ;;
        ip)       cmd_ip "$@" ;;
        doctor)   cmd_doctor "$@" ;;
        rotate-secrets) cmd_rotate_secrets "$@" ;;
        backup-state)   cmd_backup_state "$@" ;;
        backup-db)      cmd_backup_db "$@" ;;
        backup)         cmd_backup_db "$@" ;;
        upgrade-audit)  cmd_upgrade_audit "$@" ;;
        seed)           cmd_seed "$@" ;;
        help|-h|--help) cmd_help ;;
        *)
            error "Unknown command: $command"
            cmd_help
            exit 1
            ;;
    esac
}

main "$@"
