# shellcheck shell=bash
# lib/nodered.sh — optional Node-RED automation add-on (--nodered).

# shellcheck source=deploy/scripts/common/nodered-runtime-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../common/nodered-runtime-env.sh"

nodered_enabled() {
    [ "${WITH_NODERED:-false}" = "true" ]
}

# Everything the Node-RED container mounts; an install without them cannot start it.
nodered_required_files() {
    printf '%s\n' \
        "$COMPOSE_DIR/docker-compose.nodered.yml" \
        "$DEPLOY_DIR/nodered/settings.js" \
        "$DEPLOY_DIR/nodered/start.sh" \
        "$DEPLOY_DIR/nodered/healthcheck.js" \
        "$FM_DIR/packages/node-red-fleet-manager/package.json"
}

nodered_check_files() {
    local file missing=0
    while IFS= read -r file; do
        [ -f "$file" ] && continue
        error "--nodered needs $file, which this install does not have"
        missing=1
    done < <(nodered_required_files)
    return "$missing"
}

# Installs bootstrapped before --nodered have no Node-RED service account yet.
nodered_identity_missing() {
    nodered_enabled || return 1
    ! grep -Eq '^FM_NODE_RED_SERVICE_TOKEN=.+' "$STATE_DIR/zitadel.env" 2>/dev/null
}

# Upgrade and restart skip config generation; installs from before the split need it.
nodered_refresh_runtime_env() {
    [ -d "$STATE_DIR" ] || return 0
    nodered_runtime_env_write "$STATE_DIR"
}

nodered_image() {
    printf '%s' "${NODE_RED_IMAGE:-nodered/node-red:${NODE_RED_VERSION:?NODE_RED_VERSION must be pinned in deploy/VERSIONS.env}}"
}

# Up without a bootstrap and upgrade still re-apply the account's permissions.
nodered_sync_permissions() {
    local hostname="$1"
    nodered_enabled || return 0
    ZITADEL_URL="http://localhost:8080" \
    ZITADEL_HOST_HEADER="$(zitadel_host_header "${hostname}:${ZITADEL_EXTERNALPORT}" "${ZITADEL_EXTERNALSECURE:-false}")" \
    MACHINEKEY_PATH="$STATE_DIR/machinekey/zitadel-admin-sa.json" \
    STATE_FILE="$STATE_DIR/zitadel.env" \
        run_quiet "Node-RED service permissions" \
        bash "$DEPLOY_DIR/scripts/common/sync-nodered-permissions.sh"
}

# Services that upgrade pulls and restarts.
public_app_services() {
    printf '%s\n' fleet-manager
    if nodered_enabled; then
        printf '%s\n' nodered
    fi
}

# ── Node-RED volume backup (flows, credentials, context) ─────

NR_VOLUME_KEY="nodered-data"

# Sets NR_PROJECT, NR_BACKUP_DIR and NRBK_STATE_ENV for this install.
public_nodered_target() {
    NR_PROJECT="$COMPOSE_PROJECT_NAME"
    NR_BACKUP_DIR="${BACKUP_DIR:-$STATE_DIR/backups}/nodered"
    NRBK_STATE_ENV="$STATE_DIR/fm-runtime.env"
    export NRBK_STATE_ENV
}

# public_nodered_backup <label>: archive lands in NR_BACKUP_DIR.
public_nodered_backup() {
    local volume archive
    public_nodered_target
    volume="$(nrbk_resolve_volume "$NR_PROJECT" "$NR_VOLUME_KEY")" || {
        error "No Node-RED volume for compose project $NR_PROJECT"
        return 1
    }
    info "Backing up Node-RED volume $volume (Node-RED stops briefly to flush context)..."
    archive="$(NRBK_LABEL="$1" nrbk_with_nodered_stopped "$NR_PROJECT" nrbk_create "$volume" "$NR_BACKUP_DIR")" || {
        error "Node-RED backup failed"
        return 1
    }
    nrbk_rotate "$NR_BACKUP_DIR"
    ok "Node-RED backup created: $archive"
}

# The general backup skips Node-RED until its volume exists (never started).
public_nodered_backup_if_present() {
    nodered_enabled || return 0
    public_nodered_target
    nrbk_resolve_volume "$NR_PROJECT" "$NR_VOLUME_KEY" >/dev/null || {
        info "Node-RED is on but has no data volume yet, nothing to back up"
        return 0
    }
    public_nodered_backup "$1"
}

# public_nodered_restore <archive>: Node-RED is stopped around the restore.
public_nodered_restore() {
    local archive="$1" volume
    public_nodered_target
    volume="$(nrbk_resolve_volume "$NR_PROJECT" "$NR_VOLUME_KEY")" || {
        error "No Node-RED volume for compose project $NR_PROJECT; run 'up --nodered' first"
        return 1
    }
    info "Restoring Node-RED volume $volume from $archive..."
    nrbk_with_nodered_stopped "$NR_PROJECT" nrbk_restore "$archive" "$volume" || {
        error "Node-RED restore failed"
        return 1
    }
    ok "Node-RED restored and restarted"
}
