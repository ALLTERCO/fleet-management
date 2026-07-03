# shellcheck shell=bash
# DB backup + restore + rotation for the update orchestrator.
set -o pipefail

BACKUP_DIR="${BACKUP_DIR:-deploy/state/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-5}"

# Shared-infra DBs — never drop via rollback.
BK_SHARED_DB_DENYLIST="${BK_SHARED_DB_DENYLIST:-postgres template0 template1}"

# pg_dump custom format (-Fc). Already compressed, restorable by pg_restore
# with --jobs=N for parallel restore. Extension stays .dump.
# stdout: path, rc 1 on fail.
bk_dump() {
    local db_service="$1"
    local db_name="$2"
    local db_user="$3"
    local label="${4:-pre-update}"
    local ts container out
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$BACKUP_DIR"
    out="$BACKUP_DIR/${label}-${ts}.dump"
    container="$(hc_container_name "$db_service")"

    local -a dump_args=()
    local schema
    for schema in ${BK_DUMP_EXCLUDE_SCHEMAS:-}; do
        bk_validate_db_identifier "$schema" || {
            rm -f "$out"
            return 1
        }
        dump_args+=(--exclude-schema="$schema")
    done

    if ! docker exec "$container" pg_dump "${dump_args[@]}" -U "$db_user" -Fc "$db_name" >"$out" 2>/dev/null; then
        rm -f "$out"
        return 1
    fi

    local size
    size="$(bk_file_size "$out")"
    if [ "$size" -lt 1024 ]; then
        rm -f "$out"
        return 1
    fi

    # pg_restore --list verifies the custom-format header is intact.
    if ! docker exec -i "$container" pg_restore --list >/dev/null 2>&1 <"$out"; then
        rm -f "$out"
        return 1
    fi

    echo "$out"
}

# Reads last 3 backup manifests for the same label, warns to stderr when the
# new dump is < 50% of the average. Non-fatal — sanity check only.
bk_check_size_anomaly() {
    local backup_path="$1"
    local label="$2"
    local new_size avg
    new_size="$(bk_file_size "$backup_path")"
    avg="$(find "$BACKUP_DIR" -maxdepth 1 -name "${label}-*.dump" -type f ! -path "$backup_path" 2>/dev/null \
        | sort -r | head -n 3 | while IFS= read -r p; do bk_file_size "$p"; done \
        | awk '{ s += $1; n += 1 } END { if (n > 0) print int(s / n); else print 0 }')"
    if [ "$avg" -gt 0 ] && [ "$new_size" -lt $((avg / 2)) ]; then
        echo "[bk_dump] WARNING: $(basename "$backup_path") is ${new_size} bytes — < 50% of recent average (${avg}). Inspect for data loss." >&2
    fi
}

bk_create_update_backup() {
    local db_service="$1"
    local db_name="$2"
    local db_user="$3"
    local from_image="$4"
    local to_image="$5"
    local label="${6:-pre-update}"

    local backup_path
    backup_path="$(bk_dump "$db_service" "$db_name" "$db_user" "$label")" || return 1
    [ -n "$backup_path" ] || return 1

    if ! bk_write_manifest "$backup_path" "$db_service" "$db_name" "$from_image" "$to_image" "$label"; then
        rm -f "$backup_path"
        return 1
    fi
    bk_check_size_anomaly "$backup_path" "$label"
    echo "$backup_path"
}

bk_manifest_path() {
    local backup_path="$1"
    printf '%s.manifest.json' "$backup_path"
}

bk_checksum() {
    local path="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$path" | awk '{print $1}'
    else
        shasum -a 256 "$path" | awk '{print $1}'
    fi
}

bk_file_size() {
    local path="$1"
    stat -c %s "$path" 2>/dev/null || stat -f %z "$path" 2>/dev/null || echo 0
}

bk_write_manifest() {
    local backup_path="$1"
    local db_service="$2"
    local db_name="$3"
    local from_image="$4"
    local to_image="$5"
    local label="$6"
    local manifest_path tmp checksum size ts

    [ -s "$backup_path" ] || return 1
    manifest_path="$(bk_manifest_path "$backup_path")"
    tmp="$(mktemp "${manifest_path}.XXXXXX")" || return 1
    checksum="$(bk_checksum "$backup_path")"
    size="$(bk_file_size "$backup_path")"
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    jq -n \
        --arg schemaVersion "1" \
        --arg kind "fleet-manager-update-db-backup" \
        --arg label "$label" \
        --arg createdAt "$ts" \
        --arg dbService "$db_service" \
        --arg dbName "$db_name" \
        --arg path "$backup_path" \
        --arg sha256 "$checksum" \
        --arg sizeBytes "$size" \
        --arg fromImage "$from_image" \
        --arg toImage "$to_image" \
        --arg buildCommit "${FM_BUILD_COMMIT:-${GIT_COMMIT:-}}" \
        '{
            schemaVersion: $schemaVersion,
            kind: $kind,
            label: $label,
            createdAt: $createdAt,
            database: {service: $dbService, name: $dbName},
            artifact: {path: $path, sha256: $sha256, sizeBytes: ($sizeBytes | tonumber)},
            update: {fromImage: $fromImage, toImage: $toImage},
            build: {commit: $buildCommit}
        }' > "$tmp" || {
            rm -f "$tmp"
            return 1
        }
    chmod 0600 "$tmp"
    mv "$tmp" "$manifest_path"
}

bk_verify_artifact() {
    local backup_path="$1"
    local manifest_path expected actual
    [ -s "$backup_path" ] || return 1
    manifest_path="$(bk_manifest_path "$backup_path")"
    [ -f "$manifest_path" ] || return 0
    expected="$(jq -r '.artifact.sha256 // empty' "$manifest_path" 2>/dev/null || true)"
    [ -n "$expected" ] || return 1
    actual="$(bk_checksum "$backup_path")"
    [ "$actual" = "$expected" ]
}

bk_verify_backup() {
    local backup_path="$1"
    [ -s "$backup_path" ] || return 1
    case "$backup_path" in
        *.sql.gz) gunzip -t "$backup_path" 2>/dev/null || return 1 ;;
        *.dump) ;;
    esac
    bk_verify_artifact "$backup_path" || return 1
}

# Shared mtime-sorted listing — newest first. find -exec stat's exit code
# always wins because find succeeds when files exist, so probe stat flavour
# explicitly before invoking it.
bk_list_dumps_mtime_sorted() {
    [ -d "$BACKUP_DIR" ] || return 0
    find "$BACKUP_DIR" -maxdepth 1 \( -name '*.dump' -o -name '*.sql.gz' \) -type f -print 2>/dev/null |
        while IFS= read -r path; do
            [ -n "$path" ] || continue
            local mtime
            mtime="$(stat -c '%Y' "$path" 2>/dev/null || stat -f '%m' "$path" 2>/dev/null || echo 0)"
            printf '%s %s\n' "$mtime" "$path"
        done | sort -rn
}

bk_list_backups() {
    [ -d "$BACKUP_DIR" ] || return 0
    local listing
    listing="$(bk_list_dumps_mtime_sorted)"
    [ -z "$listing" ] && return 0
    echo "$listing" | while IFS= read -r row; do
        [ -n "$row" ] || continue
        local mtime path manifest_path created_at db_name label sha size valid
        mtime="${row%% *}"
        path="${row#* }"
        manifest_path="$(bk_manifest_path "$path")"
        created_at="$(date -u -r "$mtime" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$mtime" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")"
        label=""
        db_name=""
        sha="$(bk_checksum "$path" 2>/dev/null || true)"
        size="$(bk_file_size "$path")"
        if [ -f "$manifest_path" ]; then
            label="$(jq -r '.label // ""' "$manifest_path" 2>/dev/null || true)"
            db_name="$(jq -r '.database.name // ""' "$manifest_path" 2>/dev/null || true)"
        fi
        if bk_verify_backup "$path"; then
            valid=true
        else
            valid=false
        fi
        jq -n \
            --arg path "$path" \
            --arg manifest "$([ -f "$manifest_path" ] && printf '%s' "$manifest_path" || true)" \
            --arg createdAt "$created_at" \
            --arg label "$label" \
            --arg database "$db_name" \
            --arg sha256 "$sha" \
            --arg sizeBytes "$size" \
            --argjson valid "$valid" \
            '{
                path: $path,
                manifest: $manifest,
                createdAt: $createdAt,
                label: $label,
                database: $database,
                sha256: $sha256,
                sizeBytes: ($sizeBytes | tonumber),
                valid: $valid
            }'
    done
}

bk_inspect_backup() {
    local backup_path="$1"
    local manifest_path
    manifest_path="$(bk_manifest_path "$backup_path")"
    if [ -f "$manifest_path" ]; then
        jq . "$manifest_path"
        return $?
    fi
    [ -s "$backup_path" ] || return 1
    jq -n \
        --arg path "$backup_path" \
        --arg sha256 "$(bk_checksum "$backup_path")" \
        --arg sizeBytes "$(bk_file_size "$backup_path")" \
        '{
            schemaVersion: "legacy",
            kind: "fleet-manager-db-backup",
            artifact: {path: $path, sha256: $sha256, sizeBytes: ($sizeBytes | tonumber)}
        }'
}

# bk_restore <db_service> <db_name> <db_user> <backup_path>
# Caller must stop FM first. Denylist-guarded; BK_ALLOW_DROP_DB=1 overrides.
bk_restore() {
    local db_service="$1"
    local db_name="$2"
    local db_user="$3"
    local backup_path="$4"
    if [ ! -s "$backup_path" ]; then
        return 1
    fi
    bk_verify_backup "$backup_path" || return 1

    if [ "${BK_ALLOW_DROP_DB:-0}" != "1" ]; then
        for denied in $BK_SHARED_DB_DENYLIST; do
            if [ "$db_name" = "$denied" ]; then
                echo "[bk_restore] refusing to DROP shared DB '$db_name' (set BK_ALLOW_DROP_DB=1 to override)" >&2
                return 1
            fi
        done
    fi

    local container jobs
    container="$(hc_container_name "$db_service")"
    jobs="${BK_RESTORE_JOBS:-4}"

    bk_recreate_database "$container" "$db_user" "$db_name" || return 1
    bk_timescale_pre_restore "$container" "$db_user" "$db_name" || return 1
    if ! bk_restore_artifact "$container" "$db_user" "$db_name" "$backup_path" "$jobs"; then
        bk_timescale_post_restore "$container" "$db_user" "$db_name" >/dev/null 2>&1 || true
        return 1
    fi
    bk_timescale_post_restore "$container" "$db_user" "$db_name" || return 1
}

bk_restore_drill() {
    local db_service="$1"
    local db_user="$2"
    local backup_path="$3"
    local label="${4:-restore-drill}"
    [ -s "$backup_path" ] || return 1
    bk_verify_backup "$backup_path" || return 1

    local container drill_db safe_label
    container="$(hc_container_name "$db_service")"
    safe_label="$(printf '%s' "$label" | tr -c 'A-Za-z0-9_' '_' | sed 's/^_*//; s/_*$//')"
    [ -n "$safe_label" ] || safe_label="restore_drill"
    drill_db="fm_${safe_label}_$(date -u +%Y%m%d%H%M%S)_$$"
    bk_validate_db_identifier "$drill_db" || return 1

    if ! bk_recreate_database "$container" "$db_user" "$drill_db"; then
        return 1
    fi

    local rc=0 table_count
    bk_timescale_pre_restore "$container" "$db_user" "$drill_db" || rc=1
    if [ "$rc" -eq 0 ]; then
        bk_restore_artifact "$container" "$db_user" "$drill_db" "$backup_path" "${BK_RESTORE_DRILL_JOBS:-2}" || rc=1
    fi
    if [ "$rc" -eq 0 ]; then
        bk_timescale_post_restore "$container" "$db_user" "$drill_db" || rc=1
    fi
    if [ "$rc" -eq 0 ]; then
        table_count="$(docker exec "$container" psql -U "$db_user" -d "$drill_db" -AtX -v ON_ERROR_STOP=1 \
            -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');" 2>/dev/null || echo "")"
        case "$table_count" in
            ""|*[!0-9]*) rc=1 ;;
        esac
    fi

    docker exec "$container" psql -U "$db_user" -d postgres -v ON_ERROR_STOP=1 \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${drill_db}' AND pid <> pg_backend_pid();" \
        -c "DROP DATABASE IF EXISTS \"${drill_db}\";" >/dev/null 2>&1 || true
    return "$rc"
}

# Dispatch to the right tool based on file extension. `.dump` = custom format
# via pg_restore. The dump is streamed through stdin into docker exec, so
# pg_restore must run single-stream; parallel restore requires a real file path.
bk_restore_artifact() {
    local container="$1" db_user="$2" db_name="$3" path="$4"
    local err
    err="$(mktemp "${TMPDIR:-/tmp}/fm-restore-error.XXXXXX")" || return 1
    case "$path" in
        *.dump)
            local owner_args=()
            if [ "${BK_RESTORE_PRESERVE_OWNERS:-0}" != "1" ]; then
                owner_args=(--no-owner --no-acl)
            fi
            if docker exec -i "$container" pg_restore \
                "${owner_args[@]}" \
                -U "$db_user" -d "$db_name" \
                <"$path" >/dev/null 2>"$err"; then
                rm -f "$err"
                return 0
            fi
            ;;
        *.sql.gz)
            if gunzip -c "$path" | docker exec -i "$container" \
                psql -U "$db_user" -v ON_ERROR_STOP=1 "$db_name" \
                >/dev/null 2>"$err"; then
                rm -f "$err"
                return 0
            fi
            ;;
        *)
            rm -f "$err"
            echo "[bk_restore] unknown artifact format: $path" >&2
            return 1
            ;;
    esac
    echo "[bk_restore] restore failed for $path into $container/$db_name" >&2
    sed -n '1,160p' "$err" >&2
    rm -f "$err"
    return 1
}

bk_recreate_database() {
    local container="$1"
    local db_user="$2"
    local db_name="$3"

    bk_validate_db_identifier "$db_name" || return 1

    # Terminate other sessions — DROP DATABASE fails otherwise.
    docker exec "$container" psql -U "$db_user" -d postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db_name' AND pid <> pg_backend_pid();" \
        >/dev/null 2>&1 || true
    docker exec "$container" psql -U "$db_user" -d postgres -c \
        "DROP DATABASE IF EXISTS \"$db_name\";" >/dev/null 2>&1 || return 1
    docker exec "$container" psql -U "$db_user" -d postgres -c \
        "CREATE DATABASE \"$db_name\";" >/dev/null 2>&1 || return 1
}

bk_validate_db_identifier() {
    local value="$1"
    if [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        return 0
    fi
    echo "[bk_restore] invalid database identifier: $value" >&2
    return 1
}

bk_has_timescaledb() {
    local container="$1"
    local db_user="$2"
    local db_name="$3"

    [ "$(docker exec "$container" psql -U "$db_user" -d "$db_name" -Atc \
        "SELECT COUNT(*) FROM pg_available_extensions WHERE name = 'timescaledb';" 2>/dev/null || echo 0)" = "1" ]
}

bk_timescale_pre_restore() {
    local container="$1"
    local db_user="$2"
    local db_name="$3"

    bk_has_timescaledb "$container" "$db_user" "$db_name" || return 0
    docker exec "$container" psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 \
        -c "CREATE EXTENSION IF NOT EXISTS timescaledb;" \
        -c "SELECT timescaledb_pre_restore();" >/dev/null 2>&1
}

bk_timescale_post_restore() {
    local container="$1"
    local db_user="$2"
    local db_name="$3"

    bk_has_timescaledb "$container" "$db_user" "$db_name" || return 0
    docker exec "$container" psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 \
        -c "SELECT timescaledb_post_restore();" >/dev/null 2>&1
}

# bk_rotate [<keep>] — keep N newest dumps in BACKUP_DIR, delete rest.
bk_rotate() {
    local keep="${1:-$BACKUP_KEEP}"
    local listing
    listing="$(bk_list_dumps_mtime_sorted)"
    [ -z "$listing" ] && return 0
    echo "$listing" | awk -v keep="$keep" 'NR>keep {sub(/^[0-9]+ /, ""); print}' \
        | while IFS= read -r f; do
            [ -n "$f" ] && rm -f "$f" "$(bk_manifest_path "$f")"
        done
}

# Tiered retention: keep one per day for KEEP_DAILY days, one per week for
# KEEP_WEEKLY weeks, one per month for KEEP_MONTHLY months. Anything older
# is evicted. The newest in each bucket survives; older entries in the same
# bucket are deleted.
bk_rotate_time_based() {
    local keep_daily="${BACKUP_KEEP_DAILY:-7}"
    local keep_weekly="${BACKUP_KEEP_WEEKLY:-4}"
    local keep_monthly="${BACKUP_KEEP_MONTHLY:-12}"
    local listing
    listing="$(bk_list_dumps_mtime_sorted)"
    [ -z "$listing" ] && return 0

    local now day_cutoff week_cutoff month_cutoff
    now="$(date -u +%s)"
    day_cutoff=$((now - keep_daily * 86400))
    week_cutoff=$((day_cutoff - keep_weekly * 7 * 86400))
    month_cutoff=$((week_cutoff - keep_monthly * 30 * 86400))

    echo "$listing" | awk -v day="$day_cutoff" -v week="$week_cutoff" -v month="$month_cutoff" '
        {
            mtime = $1
            path  = $0
            sub(/^[0-9]+ /, "", path)
            if      (mtime >= day)   bucket = "d-" int(mtime / 86400)
            else if (mtime >= week)  bucket = "w-" int(mtime / (7 * 86400))
            else if (mtime >= month) bucket = "m-" int(mtime / (30 * 86400))
            else                     bucket = "EXPIRED"
            if (bucket == "EXPIRED" || seen[bucket]) print path
            else                                    seen[bucket] = 1
        }
    ' | while IFS= read -r f; do
        [ -n "$f" ] && rm -f "$f" "$(bk_manifest_path "$f")"
    done
}

# Check that host has enough free space for a dump (2× DB size).
bk_preflight_space() {
    local db_service="$1"
    local db_name="$2"
    local db_user="$3"
    local container
    container="$(hc_container_name "$db_service")"
    local db_bytes
    db_bytes="$(docker exec "$container" psql -U "$db_user" -d "$db_name" -tAc "SELECT pg_database_size('$db_name');" 2>/dev/null)"
    if ! [[ "$db_bytes" =~ ^[0-9]+$ ]]; then
        return 0
    fi
    mkdir -p "$BACKUP_DIR"
    local free_kb
    free_kb="$(df -kP "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
    local free_bytes=$((free_kb * 1024))
    local needed=$((db_bytes * 2))
    if [ "$free_bytes" -lt "$needed" ]; then
        local free_gb needed_gb db_gb
        free_gb="$(awk -v b="$free_bytes" 'BEGIN{printf "%.2f", b/1024/1024/1024}')"
        needed_gb="$(awk -v b="$needed" 'BEGIN{printf "%.2f", b/1024/1024/1024}')"
        db_gb="$(awk -v b="$db_bytes" 'BEGIN{printf "%.2f", b/1024/1024/1024}')"
        echo "[bk_preflight] insufficient space: need ${needed_gb} GB (2× live DB ${db_gb} GB), have ${free_gb} GB free at $BACKUP_DIR" >&2
        return 1
    fi
    return 0
}
