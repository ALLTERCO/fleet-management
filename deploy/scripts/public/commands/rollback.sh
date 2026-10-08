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

    public_kdf_salt_preflight || return 1

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
    public_kdf_salt_preflight || return 1
    public_resolve_build_identity rollback
    if ! FM_VERSION=rollback compose_cmd up -d --no-deps --force-recreate fleet-manager; then
        error "Rollback recreate failed — container may be down"
        return 1
    fi
    public_kdf_salt_confirm_container || return 1

    info "Health-gating..."
    if ! hc_wait_or_dump fleet-manager "${FM_STARTUP_TIMEOUT:-180}"; then
        error "Rollback container failed health check"
        return 1
    fi

    _cmd_rollback_record_manifest
    info "Fleet Manager rolled back to $rollback_image"
}

# The image `rollback` starts. Set by upgrade and migrate before they replace
# Fleet Manager.
public_tag_rollback_image() {
    local image_id="$1"
    if ! docker tag "$image_id" "${DOCKER_HUB_IMAGE:-shellygroup/fleet-management}:rollback"; then
        error "Could not tag the current Fleet Manager image for rollback"
        return 1
    fi
}

# The database backup `rollback` restores is the newest public-update entry
# with a backup (_cmd_rollback_latest_backup).
# Usage: public_record_rollback_point <from image> <to image> <backup path>
public_record_rollback_point() {
    local from_image="$1" to_image="$2" backup="$3" backup_manifest=""
    if [ -n "$backup" ] && [ -f "$(bk_manifest_path "$backup")" ]; then
        backup_manifest="$(bk_manifest_path "$backup")"
    fi
    UPDATE_FROM_IMAGE="$from_image" \
    UPDATE_TO_IMAGE="$to_image" \
    UPDATE_BACKUP_PATH="$backup" \
    UPDATE_BACKUP_MANIFEST_PATH="$backup_manifest" \
        manifest_record_public_update
}

# Number of manifest history entries; 0 without a manifest.
public_rollback_history_length() {
    if [ ! -f "$(manifest_path)" ]; then
        printf '0'
        return 0
    fi
    manifest_read | jq '.history | length'
}

# The first rollback backup recorded after the given history length, e.g. by
# the migrate step of an upgrade. Empty when none was recorded.
public_rollback_backup_since() {
    local history_length="$1"
    [ -f "$(manifest_path)" ] || return 0
    manifest_read | jq -r --argjson n "$history_length" '
        [.history[$n:][]
         | select(.action == "public-update")
         | select((.backup // "") != "")
         | .backup][0] // empty
    '
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
