# shellcheck shell=bash
# Public/self-hosted upgrade audit commands.

cmd_upgrade_audit() {
    local action="${1:-snapshot}"
    shift || true

    load_state_env
    load_deploy_meta
    export UPGRADE_AUDIT_DIR="${UPGRADE_AUDIT_DIR:-$STATE_DIR/upgrade-audits}"

    case "$action" in
        snapshot)         _public_upgrade_audit_snapshot_fleet "$@" ;;
        snapshot-zitadel) _public_upgrade_audit_snapshot_zitadel "$@" ;;
        compare)          _public_upgrade_audit_compare "$@" ;;
        zitadel-plan)     _public_upgrade_audit_zitadel_plan "$@" ;;
        --help|-h|help)   _public_upgrade_audit_help ;;
        *)
            error "Unknown upgrade-audit action: $action"
            _public_upgrade_audit_help
            return 1
            ;;
    esac
}

_public_upgrade_audit_out_arg() {
    local out=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --out) out="${2:?--out requires a value}"; shift 2 ;;
            *) error "Unknown upgrade-audit flag: $1"; return 1 ;;
        esac
    done
    printf '%s' "$out"
}

_public_upgrade_audit_snapshot_fleet() {
    local out path
    out="$(_public_upgrade_audit_out_arg "$@")" || return 1
    path="$(ua_snapshot_fleet fleet-db "${POSTGRES_DB:-fleet}" "${POSTGRES_USER:-postgres}" manual "$out")" || {
        error "Fleet DB upgrade snapshot failed"
        return 1
    }
    ok "Fleet DB upgrade snapshot: $path"
}

_public_upgrade_audit_snapshot_zitadel() {
    local out path
    out="$(_public_upgrade_audit_out_arg "$@")" || return 1
    path="$(ua_snapshot_zitadel zitadel-db "${ZITADEL_DB_NAME:-zitadel}" "${ZITADEL_DB_USER:-postgres}" manual "$out")" || {
        error "Zitadel DB upgrade snapshot failed"
        return 1
    }
    ok "Zitadel DB upgrade snapshot: $path"
}

_public_upgrade_audit_compare() {
    local pre="" post="" out=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --pre|--before) pre="${2:?--pre requires a value}"; shift 2 ;;
            --post|--after) post="${2:?--post requires a value}"; shift 2 ;;
            --out) out="${2:?--out requires a value}"; shift 2 ;;
            *) error "Unknown upgrade-audit compare flag: $1"; return 1 ;;
        esac
    done
    [ -n "$pre" ] || { error "upgrade-audit compare requires --pre"; return 1; }
    [ -n "$post" ] || { error "upgrade-audit compare requires --post"; return 1; }
    if ua_compare_snapshots "$pre" "$post" "$out"; then
        ok "Upgrade audit compare passed"
        return 0
    fi
    error "Upgrade audit compare failed"
    return 1
}

_public_upgrade_audit_zitadel_plan() {
    local target_zitadel="${ZITADEL_VERSION:-v4.14.0}" target_pg="${ZITADEL_POSTGRES_VERSION:-18.3-alpine3.23}" out=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --target-zitadel) target_zitadel="${2:?--target-zitadel requires a value}"; shift 2 ;;
            --target-pg) target_pg="${2:?--target-pg requires a value}"; shift 2 ;;
            --out) out="${2:?--out requires a value}"; shift 2 ;;
            *) error "Unknown upgrade-audit zitadel-plan flag: $1"; return 1 ;;
        esac
    done

    local project current_pg target_pg_major id image current_version path
    project="${COMPOSE_PROJECT_NAME:-fleet-public}"
    target_pg_major="$(compat_postgres_major_from_tag "$target_pg" || true)"
    current_pg="$(compat_volume_pg_major "$project" zitadel-db || true)"
    if [ -z "$current_pg" ]; then
        id="$(compat_service_container_id "$project" zitadel-db || true)"
        [ -n "$id" ] && current_pg="$(compat_postgres_major_from_image "$(compat_container_image "$id")" || true)"
    fi
    id="$(compat_service_container_id "$project" zitadel-api || compat_service_container_id "$project" zitadel || true)"
    image=""
    [ -n "$id" ] && image="$(compat_container_image "$id")"
    current_version="$(printf '%s' "$image" | sed -n 's/.*zitadel:\(v[0-9][^@ ]*\).*/\1/p')"
    [ -n "$current_version" ] || current_version="${ZITADEL_VERSION_CURRENT:-unknown}"

    path="$(ua_plan_zitadel_upgrade "$current_version" "$target_zitadel" "$current_pg" "$target_pg_major" "$out")" || return 1
    jq . "$path"
    if jq -e '.safeDirect == true' "$path" >/dev/null; then
        ok "Zitadel upgrade plan is direct-safe: $path"
        return 0
    fi
    warn "Zitadel upgrade requires staged migration: $path"
    return 1
}

_public_upgrade_audit_help() {
    cat <<'EOF'
Usage: deploy-public.sh upgrade-audit <snapshot|snapshot-zitadel|compare|zitadel-plan>

  snapshot [--out PATH]             Snapshot Fleet DB schema/table/domain state
  snapshot-zitadel [--out PATH]     Snapshot Zitadel DB schema/table/event state
  compare --pre A --post B          Compare snapshots; fails on data-loss signals
  zitadel-plan [--target-zitadel V] [--target-pg TAG]
                                    Print required staged Zitadel/Postgres path
EOF
}
