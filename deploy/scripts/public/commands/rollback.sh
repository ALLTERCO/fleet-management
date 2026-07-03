# shellcheck shell=bash
# Public rollback — revert FM to fleet-manager:rollback tag.
# Pre-condition: a prior `upgrade` ran and tagged the previous image.

cmd_rollback() {
    local image_only=0
    local backup_path=""
    local runtime_args=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --image-only) image_only=1 ;;
            --backup)     backup_path="${2:?--backup requires a path}"; shift ;;
            --help|-h)    _cmd_rollback_help; return 0 ;;
            *)            runtime_args+=("$1") ;;
        esac
        shift
    done
    parse_runtime_flags "${runtime_args[@]}" || return 1
    enable_debug_mode

    step "Rolling back Fleet Manager"

    load_state_env
    load_deploy_meta
    export DOCKER_HUB_IMAGE="${DOCKER_HUB_IMAGE:-shellygroup/fleet-management}"
    local rollback_image="${DOCKER_HUB_IMAGE}:rollback"

    if ! docker image inspect "$rollback_image" >/dev/null 2>&1; then
        error "No rollback image found ($rollback_image)"
        error "Was 'deploy-public.sh upgrade' run successfully before?"
        return 1
    fi

    if [ -f "$(manifest_path)" ] && ! manifest_require_valid; then
        return 1
    fi

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT FLEET_MANAGER_PORT FM_VERSION

    if [ "$image_only" != "1" ]; then
        backup_path="${backup_path:-$(_cmd_rollback_latest_backup)}"
        if [ -z "$backup_path" ] || [ ! -s "$backup_path" ]; then
            error "No usable DB backup found for rollback."
            error "Pass --backup <path> or use --image-only to skip DB restore explicitly."
            return 1
        fi
        info "Stopping FM before DB restore..."
        compose_cmd stop fleet-manager >/dev/null 2>&1 || true
        info "Restoring DB from $backup_path..."
        DB_SERVICE=fleet-db DB_NAME="${POSTGRES_DB:-fleet}" DB_USER="${POSTGRES_USER:-postgres}" \
            bk_restore fleet-db "${POSTGRES_DB:-fleet}" "${POSTGRES_USER:-postgres}" "$backup_path" || {
                error "DB restore failed — rollback aborted before starting old app"
                return 1
            }
    else
        warn "Image-only rollback requested — database schema/data is not restored"
    fi

    info "Recreating FM container with $rollback_image..."
    if ! FM_VERSION=rollback compose_cmd up -d --no-deps --force-recreate fleet-manager; then
        error "Rollback recreate failed — container may be down"
        return 1
    fi

    info "Health-gating..."
    if ! hc_wait_or_dump fleet-manager "${FM_STARTUP_TIMEOUT:-180}"; then
        error "Rollback container failed health check"
        return 1
    fi

    _cmd_rollback_record_manifest
    info "Fleet Manager rolled back to $rollback_image"
}

_cmd_rollback_latest_backup() {
    [ -f "$(manifest_path)" ] || return 0
    manifest_read 2>/dev/null | jq -r '
        [.history[]
         | select(.action == "public-update")
         | select((.backup // "") != "")
         | .backup][-1] // empty
    '
}

# Manifest entry mirrors manifest_record_public_update so history reads cleanly.
_cmd_rollback_record_manifest() {
    [ -f "$(manifest_path)" ] || return 0
    local revision; revision="$(manifest_revision_next)"
    local ts; ts="$(_manifest_iso8601)"
    manifest_snapshot "$revision"

    local current updated
    current="$(manifest_read)" || return 1
    updated="$(printf '%s' "$current" | jq \
        --arg image    "${DOCKER_HUB_IMAGE:-shellygroup/fleet-management}:rollback" \
        --arg ts       "$ts" \
        --arg revision "$revision" \
        '.shared_services.fleet_manager.image = $image |
         .shared_services.fleet_manager.last_updated_at = $ts |
         .shared_services.fleet_manager.last_revision = $revision')"
    manifest_write "$updated"
    local extra
    extra="$(jq -n \
        --arg backup "${backup_path:-}" \
        --arg mode "$([ "${image_only:-0}" = "1" ] && printf image-only || printf db-and-image)" \
        '{backup: $backup, mode: $mode}')"
    manifest_add_history "$revision" "public-rollback" "fleet_manager" "$extra"
}

_cmd_rollback_help() {
    cat <<'EOF'
Usage: deploy-public.sh rollback [--backup PATH] [--image-only]

Default rollback restores the latest recorded pre-update DB backup, then starts
the rollback image. Use --backup PATH to choose a specific dump. Use
--image-only only when you intentionally do not want DB restore.
EOF
}
