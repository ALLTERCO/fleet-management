# shellcheck shell=bash
# Safe client-update orchestrator. Sourced by deploy-public.sh and
# deploy.sh `update` commands. Callers provide the env + compose context;
# this library owns: preflight → backup → apply → smoke → rollback.
#
# Requires healthwait.sh, backup.sh, smoke.sh already sourced.

# Single-writer lock so parallel updates can't race.
UPDATE_LOCK_FILE="${UPDATE_LOCK_FILE:-deploy/state/update.lock}"
declare -ga UPD_LOCK_FILES_TO_RELEASE=()

_upd_boot_id() {
    # PID 1 start time — proxy for host boot, survives PID reuse.
    stat -c %Y /proc/1 2>/dev/null || echo 0
}

upd_acquire_lock() {
    mkdir -p "$(dirname "$UPDATE_LOCK_FILE")"
    local now
    now="$(date +%s)"
    local boot
    boot="$(_upd_boot_id)"
    if [ -e "$UPDATE_LOCK_FILE" ]; then
        local existing_pid existing_boot existing_ts
        IFS=$'\t' read -r existing_pid existing_boot existing_ts \
            <"$UPDATE_LOCK_FILE" 2>/dev/null || true
        # Stale = boot changed, age > 1h, or pid dead.
        if [ "$existing_boot" = "$boot" ] \
            && [ -n "$existing_pid" ] \
            && kill -0 "$existing_pid" 2>/dev/null \
            && [ -n "$existing_ts" ] \
            && [ $((now - existing_ts)) -lt 3600 ]; then
            return 1
        fi
        rm -f "$UPDATE_LOCK_FILE"
    fi
    printf '%s\t%s\t%s\n' "$$" "$boot" "$now" >"$UPDATE_LOCK_FILE"
    upd_register_lock_cleanup "$UPDATE_LOCK_FILE"
}

upd_release_registered_locks() {
    local lock_file
    for lock_file in "${UPD_LOCK_FILES_TO_RELEASE[@]}"; do
        [ -n "$lock_file" ] && rm -f "$lock_file"
    done
}

upd_extract_exit_trap_body() {
    local trap_line="$1"
    [ -n "$trap_line" ] || return 1
    local -a parts=()
    eval "parts=($trap_line)"
    [ "${parts[0]:-}" = "trap" ] || return 1
    [ "${parts[1]:-}" = "--" ] || return 1
    [ "${parts[3]:-}" = "EXIT" ] || return 1
    printf '%s' "${parts[2]}"
}

upd_register_lock_cleanup() {
    local lock_file="$1"
    local existing
    for existing in "${UPD_LOCK_FILES_TO_RELEASE[@]}"; do
        [ "$existing" = "$lock_file" ] && return 0
    done
    UPD_LOCK_FILES_TO_RELEASE+=("$lock_file")

    local prior
    prior="$(upd_extract_exit_trap_body "$(trap -p EXIT)" 2>/dev/null || true)"
    case "$prior" in
        *upd_release_registered_locks*) trap -- "$prior" EXIT ;;
        "") trap -- "upd_release_registered_locks" EXIT ;;
        *) trap -- "$prior; upd_release_registered_locks" EXIT ;;
    esac
}

# Read current FM image tag from the running container.
# Returns empty if no FM running (fresh install).
upd_current_image_tag() {
    local container
    container="$(hc_container_name fleet-manager)"
    docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true
}

# Audit row: ts\tclient\tstatus\tfrom\tto\tbackup.
upd_log_event() {
    local status="$1"
    local from_tag="$2"
    local to_tag="$3"
    local backup_path="${4:-}"
    local client="${UPD_CLIENT_ID:-default}"
    local log_file="${UPDATE_HISTORY_LOG:-deploy/state/update-history.log}"
    mkdir -p "$(dirname "$log_file")"
    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if ! printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$ts" "$client" "$status" "$from_tag" "$to_tag" "$backup_path" \
        >>"$log_file"
    then
        echo "[update] WARN: failed to append to $log_file (disk full?)" >&2
    fi
}

# Env: DB_SERVICE, DB_NAME, DB_USER, FM_SERVICE, FM_HEALTH_URL,
#      UPD_TARGET_TAG (required); UPD_NO_BACKUP, UPD_NO_SMOKE, SMOKE_TOKEN.
# Caller-defined hooks: upd_apply_new_version, upd_revert_version.
upd_run() {
    : "${DB_SERVICE:?}" "${DB_NAME:?}" "${DB_USER:?}" "${FM_SERVICE:?}"
    : "${FM_HEALTH_URL:?}" "${UPD_TARGET_TAG:?}"
    export UPD_LAST_BACKUP_PATH=""
    export UPD_LAST_BACKUP_MANIFEST_PATH=""
    export UPD_LAST_PRE_AUDIT_PATH=""
    export UPD_LAST_POST_AUDIT_PATH=""
    export UPD_LAST_AUDIT_REPORT_PATH=""

    if ! upd_acquire_lock; then
        echo "[update] another update is already running (pid $(cat "$UPDATE_LOCK_FILE"))" >&2
        return 1
    fi

    local from_tag
    from_tag="$(upd_current_image_tag)"
    echo "[update] from: ${from_tag:-<none>} → to: $UPD_TARGET_TAG"

    local backup_path
    backup_path="$(_upd_create_pre_update_backup "$from_tag")" || return 1
    if [ -n "$backup_path" ]; then
        export UPD_LAST_BACKUP_PATH="$backup_path"
        export UPD_LAST_BACKUP_MANIFEST_PATH="$(bk_manifest_path "$backup_path")"
    fi

    _upd_create_pre_update_audit "$from_tag" || return 1

    _upd_apply_or_rollback "$from_tag" "$backup_path" || return 1
    _upd_health_or_rollback "$from_tag" "$backup_path" || return 1
    _upd_smoke_or_rollback "$from_tag" "$backup_path" || return 1
    _upd_audit_or_rollback "$from_tag" "$backup_path" || return 1

    if ! _upd_soak_monitor "$from_tag" "$backup_path"; then
        return 1
    fi

    bk_rotate
    upd_log_event "success" "$from_tag" "$UPD_TARGET_TAG" "$backup_path"
    echo "[update] success. backup kept at $backup_path"
}

_upd_create_pre_update_audit() {
    local from_tag="$1"

    if [ "${UPD_NO_AUDIT:-}" = "1" ]; then
        echo "[update] skipping migration audit (UPD_NO_AUDIT=1)"
        return 0
    fi
    if ! command -v jq >/dev/null 2>&1; then
        echo "[update] jq missing — cannot run migration audit" >&2
        upd_log_event "abort-audit-prereq" "$from_tag" "$UPD_TARGET_TAG" "${UPD_LAST_BACKUP_PATH:-}"
        return 1
    fi
    if ! declare -F ua_snapshot_fleet >/dev/null 2>&1; then
        echo "[update] upgrade audit library not loaded — cannot prove migration state" >&2
        upd_log_event "abort-audit-missing" "$from_tag" "$UPD_TARGET_TAG" "${UPD_LAST_BACKUP_PATH:-}"
        return 1
    fi

    echo "[update] capturing pre-update migration snapshot..."
    local audit_path
    audit_path="$(ua_snapshot_fleet "$DB_SERVICE" "$DB_NAME" "$DB_USER" "pre-update-${UPD_CLIENT_ID:-default}")" || {
        echo "[update] pre-update migration snapshot failed — aborting before changes" >&2
        upd_log_event "abort-audit-pre" "$from_tag" "$UPD_TARGET_TAG" "${UPD_LAST_BACKUP_PATH:-}"
        return 1
    }
    export UPD_LAST_PRE_AUDIT_PATH="$audit_path"
    echo "[update] pre-update audit: $audit_path"
}

_upd_create_pre_update_backup() {
    local from_tag="$1"
    local backup_path=""

    if [ "${UPD_NO_BACKUP:-}" = "1" ]; then
        echo "[update] skipping backup (UPD_NO_BACKUP=1)" >&2
        printf '%s' ""
        return 0
    fi

    if ! bk_preflight_space "$DB_SERVICE" "$DB_NAME" "$DB_USER"; then
        echo "[update] insufficient disk space for backup — aborting" >&2
        upd_log_event "abort-disk" "$from_tag" "$UPD_TARGET_TAG"
        return 1
    fi

    echo "[update] taking pre-update backup..." >&2
    backup_path="$(bk_create_update_backup \
        "$DB_SERVICE" "$DB_NAME" "$DB_USER" "$from_tag" "$UPD_TARGET_TAG" pre-update)"
    if [ -z "$backup_path" ]; then
        echo "[update] pg_dump failed — aborting (no changes applied)" >&2
        upd_log_event "abort-backup" "$from_tag" "$UPD_TARGET_TAG"
        return 1
    fi

    echo "[update] backup: $backup_path" >&2
    export UPD_LAST_BACKUP_PATH="$backup_path"
    export UPD_LAST_BACKUP_MANIFEST_PATH="$(bk_manifest_path "$backup_path")"
    printf '%s' "$backup_path"
}

_upd_apply_or_rollback() {
    local from_tag="$1" backup_path="$2"
    echo "[update] pulling + applying $UPD_TARGET_TAG..."
    if upd_apply_new_version "$UPD_TARGET_TAG"; then
        return 0
    fi
    echo "[update] apply step failed — rolling back" >&2
    upd_rollback "$from_tag" "$backup_path"
    upd_log_event "fail-apply" "$from_tag" "$UPD_TARGET_TAG" "$backup_path"
    return 1
}

_upd_health_or_rollback() {
    local from_tag="$1" backup_path="$2"
    echo "[update] waiting for $FM_SERVICE to become healthy..."
    if hc_wait_or_dump "$FM_SERVICE" "${FM_STARTUP_TIMEOUT:-180}"; then
        return 0
    fi
    echo "[update] health check failed — rolling back" >&2
    upd_rollback "$from_tag" "$backup_path"
    upd_log_event "fail-health" "$from_tag" "$UPD_TARGET_TAG" "$backup_path"
    return 1
}

_upd_smoke_or_rollback() {
    local from_tag="$1" backup_path="$2"
    if [ "${UPD_NO_SMOKE:-}" = "1" ]; then
        echo "[update] skipping smoke tests (UPD_NO_SMOKE=1)"
        return 0
    fi
    echo "[update] running smoke tests..."
    if sm_run_default "$FM_HEALTH_URL" "${SMOKE_TOKEN:-}"; then
        return 0
    fi
    echo "[update] smoke tests failed — rolling back" >&2
    upd_rollback "$from_tag" "$backup_path"
    upd_log_event "fail-smoke" "$from_tag" "$UPD_TARGET_TAG" "$backup_path"
    return 1
}

_upd_audit_or_rollback() {
    local from_tag="$1" backup_path="$2"
    if [ "${UPD_NO_AUDIT:-}" = "1" ]; then
        return 0
    fi
    if [ -z "${UPD_LAST_PRE_AUDIT_PATH:-}" ]; then
        echo "[update] no pre-update audit path recorded — rolling back" >&2
        upd_rollback "$from_tag" "$backup_path"
        upd_log_event "fail-audit-missing-pre" "$from_tag" "$UPD_TARGET_TAG" "$backup_path"
        return 1
    fi

    echo "[update] capturing post-update migration snapshot..."
    local post_path report_path
    post_path="$(ua_snapshot_fleet "$DB_SERVICE" "$DB_NAME" "$DB_USER" "post-update-${UPD_CLIENT_ID:-default}")" || {
        echo "[update] post-update migration snapshot failed — rolling back" >&2
        upd_rollback "$from_tag" "$backup_path"
        upd_log_event "fail-audit-post" "$from_tag" "$UPD_TARGET_TAG" "$backup_path"
        return 1
    }
    export UPD_LAST_POST_AUDIT_PATH="$post_path"

    report_path="${UPGRADE_AUDIT_DIR:-${STATE_DIR:-deploy/state}/upgrade-audits}/compare-update-${UPD_CLIENT_ID:-default}-$(date -u +%Y%m%dT%H%M%SZ).json"
    if ua_compare_snapshots "$UPD_LAST_PRE_AUDIT_PATH" "$post_path" "$report_path"; then
        export UPD_LAST_AUDIT_REPORT_PATH="$report_path"
        echo "[update] migration audit passed: $report_path"
        return 0
    fi

    export UPD_LAST_AUDIT_REPORT_PATH="$report_path"
    echo "[update] migration audit failed — rolling back. Report: $report_path" >&2
    jq . "$report_path" >&2 2>/dev/null || true
    upd_rollback "$from_tag" "$backup_path"
    upd_log_event "fail-audit-compare" "$from_tag" "$UPD_TARGET_TAG" "$backup_path"
    return 1
}

# Optional post-health soak: poll FM container health for UPDATE_SOAK_SECONDS.
# Triggers full rollback on any degradation. UPDATE_SOAK_SECONDS=0 (default)
# skips — backwards-compatible. Set UPDATE_SOAK_POLL_INTERVAL (default 10).
_upd_soak_monitor() {
    local from_tag="$1" backup_path="$2"
    local soak="${UPDATE_SOAK_SECONDS:-0}"
    [ "$soak" = "0" ] && return 0

    local poll="${UPDATE_SOAK_POLL_INTERVAL:-10}"
    local elapsed=0
    local container; container="$(hc_container_name "$FM_SERVICE")"
    echo "[update] soak monitor — polling health for ${soak}s..."
    while [ "$elapsed" -lt "$soak" ]; do
        sleep "$poll"
        elapsed=$((elapsed + poll))
        local status
        status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
        if [ "$status" != "healthy" ] && [ "$status" != "running" ]; then
            echo "[update] soak failed at ${elapsed}s — container health: ${status:-unknown}" >&2
            upd_rollback "$from_tag" "$backup_path"
            upd_log_event "fail-soak" "$from_tag" "$UPD_TARGET_TAG" "$backup_path"
            return 1
        fi
        echo "[update]   +${elapsed}s healthy"
    done
    echo "[update] soak passed (${soak}s of stable health)"
}

# Roll back to the previous tag + restore backup. Callable standalone:
#   upd_rollback <original_tag> <backup_path>
upd_rollback() {
    local original_tag="$1"
    local backup_path="$2"

    # If there's no previous version (fresh install failure), there's
    # nothing to revert to — just stop FM so operators know it's down.
    if [ -z "$original_tag" ]; then
        echo "[rollback] no previous version to revert to — leaving stopped" >&2
        return 0
    fi

    echo "[rollback] reverting image tag to $original_tag..."
    if ! upd_revert_version "$original_tag"; then
        echo "[rollback] failed to revert image — MANUAL INTERVENTION REQUIRED" >&2
        return 1
    fi

    if [ -n "$backup_path" ] && [ -s "$backup_path" ]; then
        echo "[rollback] stopping FM before DB restore..."
        docker stop "$(hc_container_name "$FM_SERVICE")" >/dev/null 2>&1 || true
        echo "[rollback] restoring DB from $backup_path..."
        if ! bk_restore "$DB_SERVICE" "$DB_NAME" "$DB_USER" "$backup_path"; then
            echo "[rollback] database restore failed — MANUAL INTERVENTION REQUIRED" >&2
            return 1
        fi
        echo "[rollback] starting FM at $original_tag..."
        # revert, not apply: the apply hook may rebuild the NEW version, which
        # would leave new code on the just-restored old schema.
        if ! upd_revert_version "$original_tag"; then
            echo "[rollback] failed to start FM at $original_tag — MANUAL INTERVENTION REQUIRED" >&2
            return 1
        fi
        if ! hc_wait_or_dump "$FM_SERVICE" "${FM_STARTUP_TIMEOUT:-180}"; then
            echo "[rollback] FM unhealthy after restore at $original_tag — MANUAL INTERVENTION REQUIRED" >&2
            return 1
        fi
    fi
    echo "[rollback] complete — instance reverted to $original_tag"
}
