# shellcheck shell=bash
# Compatibility transitions for older compose layouts.

compat_remove_legacy_zitadel_container() {
    local project="${1:-${COMPOSE_PROJECT_NAME:-fm}}"
    local -a names=(
        "${project}-zitadel-1"
        "${project}_zitadel_1"
        "fm-zitadel-1"
        "fm_zitadel_1"
        "zitadel-fleet-management"
    )
    local name id
    for name in "${names[@]}"; do
        id="$(docker ps -aq --filter "name=^${name}$" 2>/dev/null | head -1 || true)"
        [ -n "$id" ] || continue
        echo "[compat] removing legacy Zitadel API container '$name' before starting zitadel-api" >&2
        docker rm -f "$id" >/dev/null || return 1
    done
}

compat_backup_zitadel_db_if_running() {
    local backup_script="$1"
    local state_dir="$2"
    local project="${3:-${COMPOSE_PROJECT_NAME:-fm}}"
    local -a names=(
        "${project}-zitadel-db-1"
        "${project}_zitadel-db_1"
        "fm-zitadel-db-1"
        "fm_zitadel-db_1"
    )
    local name id
    for name in "${names[@]}"; do
        id="$(docker ps -q --filter "name=^${name}$" 2>/dev/null | head -1 || true)"
        [ -n "$id" ] || continue
        [ -x "$backup_script" ] || return 0
        echo "[compat] backing up existing Zitadel DB before infra startup: $name" >&2
        ZITADEL_DB_CONTAINER="$name" \
        FM_BACKUP_DIR="$state_dir/backups/zitadel-pre-up" \
            bash "$backup_script" >/dev/null || return 1
        return 0
    done
}

compat_service_container_id() {
    local project="$1"
    local service="$2"
    local name id
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        id="$(docker ps -q --filter "name=^${name}$" 2>/dev/null | head -1 || true)"
        [ -n "$id" ] || continue
        printf '%s' "$id"
        return 0
    done < <(compat_service_candidate_names "$project" "$service")
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        id="$(docker ps -aq --filter "name=^${name}$" 2>/dev/null | head -1 || true)"
        [ -n "$id" ] || continue
        printf '%s' "$id"
        return 0
    done < <(compat_service_candidate_names "$project" "$service")
    return 1
}

compat_service_container_name() {
    local project="$1"
    local service="$2"
    local name id
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        id="$(docker ps -q --filter "name=^${name}$" 2>/dev/null | head -1 || true)"
        [ -n "$id" ] || continue
        printf '%s' "$name"
        return 0
    done < <(compat_service_candidate_names "$project" "$service")
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        id="$(docker ps -aq --filter "name=^${name}$" 2>/dev/null | head -1 || true)"
        [ -n "$id" ] || continue
        printf '%s' "$name"
        return 0
    done < <(compat_service_candidate_names "$project" "$service")
    return 1
}

compat_service_candidate_names() {
    local project="$1"
    local service="$2"
    printf '%s\n' \
        "${project}-${service}-1" \
        "${project}_${service}_1"

    if compat_is_child_project "$project"; then
        return 0
    fi

    printf '%s\n' \
        "fm-${service}-1" \
        "fm_${service}_1"

    case "$service" in
        fleet-db)
            printf '%s\n' "timescale-fleet-manager"
            ;;
        fleet-manager)
            printf '%s\n' "fleet-manager"
            ;;
        zitadel-api)
            printf '%s\n' \
                "${project}-zitadel-1" \
                "${project}_zitadel_1" \
                "fm-zitadel-1" \
                "fm_zitadel_1" \
                "zitadel-fleet-management"
            ;;
        zitadel-db)
            printf '%s\n' "postgresql-fleet-manager"
            ;;
        mailcatcher)
            printf '%s\n' "mailcatcher-fleet-manager"
            ;;
        grafana|mdns-repeater)
            printf '%s\n' "$service"
            ;;
    esac
}

compat_is_child_project() {
    local project="$1"
    local active="${COMPOSE_PROJECT_NAME:-fm}"
    [ "$project" != "$active" ] || return 1
    case "$project" in
        "${active}-"*) return 0 ;;
        *) return 1 ;;
    esac
}

compat_container_image() {
    local container_id="$1"
    docker inspect -f '{{.Config.Image}}' "$container_id" 2>/dev/null || true
}

compat_postgres_major_from_image() {
    local image="$1"
    case "$image" in
        *-pg[0-9]*)
            printf '%s' "$image" | sed -n 's/.*-pg\([0-9][0-9]*\).*/\1/p'
            ;;
        postgres:[0-9]*|*/postgres:[0-9]*)
            printf '%s' "$image" | sed -n 's/.*postgres:\([0-9][0-9]*\).*/\1/p'
            ;;
        *)
            return 1
            ;;
    esac
}

compat_postgres_major_from_tag() {
    local tag="$1"
    case "$tag" in
        *-pg[0-9]*)
            printf '%s' "$tag" | sed -n 's/.*-pg\([0-9][0-9]*\).*/\1/p'
            ;;
        [0-9]*)
            printf '%s' "$tag" | sed -n 's/^\([0-9][0-9]*\).*/\1/p'
            ;;
        *)
            return 1
            ;;
    esac
}

compat_volume_pg_major() {
    local project="$1"
    local service="$2"
    local volume

    while IFS= read -r volume; do
        [ -n "$volume" ] || continue
        docker volume inspect "$volume" >/dev/null 2>&1 || continue
        docker run --rm -v "$volume:/volume:ro" busybox sh -c \
            'cat /volume/PG_VERSION 2>/dev/null || cat /volume/data/PG_VERSION 2>/dev/null || true' \
            2>/dev/null | head -1
        return 0
    done < <(compat_service_candidate_volumes "$project" "$service")
    return 1
}

compat_service_candidate_volumes() {
    local project="$1"
    local service="$2"
    case "$service" in
        fleet-db)
            printf '%s\n' \
                "${project}_fleet-db-data" \
                "${project}_timescale-fleet-manager-v"
            ;;
        zitadel-db)
            printf '%s\n' \
                "${project}_zitadel-db-data" \
                "${project}_postgresql-fleet-manager-v"
            ;;
        *) return 1 ;;
    esac

    if compat_is_child_project "$project"; then
        return 0
    fi

    case "$service" in
        fleet-db)
            printf '%s\n' \
                "fleet-manager_timescale-fleet-manager-v" \
                "timescale-fleet-manager-v"
            ;;
        zitadel-db)
            printf '%s\n' \
                "fleet-manager_postgresql-fleet-manager-v" \
                "postgresql-fleet-manager-v"
            ;;
    esac
}

compat_refuse_postgres_major_change() {
    local project="$1"
    local service="$2"
    local target_tag="$3"
    local label="$4"
    local id image current_major target_major source

    id="$(compat_service_container_id "$project" "$service" || true)"
    if [ -n "$id" ]; then
        image="$(compat_container_image "$id")"
        current_major="$(compat_postgres_major_from_image "$image" || true)"
        source="$service container image $image"
    else
        current_major="$(compat_volume_pg_major "$project" "$service" || true)"
        source="$service data volume"
    fi
    target_major="$(compat_postgres_major_from_tag "$target_tag" || true)"
    [ -n "$current_major" ] && [ -n "$target_major" ] || return 0
    [ "$current_major" = "$target_major" ] && return 0

    cat >&2 <<EOF
[compat] refusing unsafe PostgreSQL major-version jump for $label
[compat]   existing source:    $source (PostgreSQL $current_major)
[compat]   configured target:  $target_tag (PostgreSQL $target_major)
[compat] Official Zitadel upgrade guidance requires a database backup before upgrade
[compat] and lets the new Zitadel setup phase run database migrations. PostgreSQL
[compat] data directories still cannot be started in-place across major versions.
[compat] Use an explicit dump/restore migration path; normal 'up' will not risk data loss.
EOF
    return 1
}

# Reads installed TimescaleDB extension version from the running DB.
# Stdout: extversion (e.g. 2.26.3), empty when extension not installed.
compat_timescale_extension_version() {
    local container="$1" db_user="$2" db_name="$3"
    docker exec "$container" psql -U "$db_user" -d "$db_name" -tAc \
        "SELECT extversion FROM pg_extension WHERE extname='timescaledb';" \
        2>/dev/null | tr -d '[:space:]'
}

compat_postgres_server_version() {
    local container="$1" db_user="$2" db_name="$3"
    docker exec "$container" psql -U "$db_user" -d "$db_name" -tAc \
        "SELECT current_setting('server_version');" \
        2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

# Pulls the TimescaleDB version from a timescaledb image tag (e.g.
# `2.26.3-pg18` -> `2.26.3`). Stdout: version, rc 1 when unparseable.
compat_timescale_version_from_tag() {
    local tag="$1"
    case "$tag" in
        [0-9]*)
            printf '%s' "$tag" | sed -n 's/^\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p'
            ;;
        *) return 1 ;;
    esac
}

compat_semver_compare() {
    local a="$1" b="$2"
    local a1 a2 a3 b1 b2 b3
    IFS=. read -r a1 a2 a3 _ <<<"$a"
    IFS=. read -r b1 b2 b3 _ <<<"$b"
    a1="${a1:-0}"; a2="${a2:-0}"; a3="${a3:-0}"
    b1="${b1:-0}"; b2="${b2:-0}"; b3="${b3:-0}"
    local av bv av_bv
    for av_bv in "$a1:$b1" "$a2:$b2" "$a3:$b3"; do
        av="${av_bv%%:*}"
        bv="${av_bv##*:}"
        if [ "$((10#$av))" -lt "$((10#$bv))" ]; then
            printf '%s' "-1"
            return 0
        fi
        if [ "$((10#$av))" -gt "$((10#$bv))" ]; then
            printf '%s' "1"
            return 0
        fi
    done
    printf '%s' "0"
}

compat_timescale_match_status() {
    local actual="$1" expected="$2"
    if [ -z "$actual" ] || [ -z "$expected" ]; then
        printf '%s' "unknown"
        return 0
    fi
    local cmp
    cmp="$(compat_semver_compare "$actual" "$expected")"
    case "$cmp" in
        0) printf '%s' "match" ;;
        -1) printf '%s' "stale" ;;
        *) printf '%s' "mismatch" ;;
    esac
}

# Runs `ALTER EXTENSION timescaledb UPDATE` if the running extension lags
# the image's bundled version. Non-fatal — logs the result either way.
compat_update_timescale_extension() {
    local container="$1" db_user="$2" db_name="$3" target_tag="$4"
    local installed target
    installed="$(compat_timescale_extension_version "$container" "$db_user" "$db_name")"
    [ -n "$installed" ] || return 0
    target="$(compat_timescale_version_from_tag "$target_tag" || true)"
    [ -n "$target" ] || return 0
    [ "$installed" = "$target" ] && return 0
    echo "[compat] TimescaleDB extension drift: installed $installed → image $target. Applying ALTER EXTENSION UPDATE..." >&2
    if docker exec "$container" psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 \
        -c "ALTER EXTENSION timescaledb UPDATE;" >/dev/null 2>&1; then
        echo "[compat] TimescaleDB extension upgraded to $target." >&2
    else
        echo "[compat] TimescaleDB ALTER EXTENSION UPDATE failed — hypertables may not load. Check logs." >&2
        return 1
    fi
}

# Image major versions for non-PG services. Compares running image tag to
# the configured target; warns (does not refuse) on major-version drift.
compat_warn_image_major_jump() {
    local project="$1" service="$2" target_tag="$3" label="$4"
    local id image current_major target_major
    id="$(compat_service_container_id "$project" "$service" || true)"
    [ -n "$id" ] || return 0
    image="$(compat_container_image "$id")"
    current_major="$(compat_image_major_from_tag "${image##*:}" || true)"
    target_major="$(compat_image_major_from_tag "$target_tag" || true)"
    [ -n "$current_major" ] && [ -n "$target_major" ] || return 0
    [ "$current_major" = "$target_major" ] && return 0
    cat >&2 <<EOF
[compat] $label major image jump detected
[compat]   running: $image (major $current_major)
[compat]   target:  $target_tag (major $target_major)
[compat] Review the service's upgrade notes before proceeding.
EOF
}

# Common semver-ish "first integer" extractor — works for `v4.14.0`,
# `7.2-alpine`, `4.1.10-22`, etc.
compat_image_major_from_tag() {
    local tag="$1"
    printf '%s' "$tag" | sed -n 's/^v\{0,1\}\([0-9][0-9]*\).*/\1/p'
}

# Pull the Zitadel image major (2 / 3 / 4) from a tag like `v4.14.0` or
# `ghcr.io/zitadel/zitadel:v3.4.9`. Stdout: major int, rc 1 when unparseable.
compat_zitadel_major_from_tag() {
    local tag="$1" bare major
    bare="${tag##*:}"
    bare="${bare#v}"
    major="$(printf '%s' "$bare" | sed -n 's/^\([0-9][0-9]*\)\(\..*\)\{0,1\}$/\1/p')"
    [ -n "$major" ] || return 1
    printf '%s' "$major"
}

# Same as compat_image_major_from_tag but the bare-tag form (`v4.14.0` etc).
compat_zitadel_major_from_image() {
    compat_zitadel_major_from_tag "${1##*:}"
}

# Pick the next stage to advance towards `target` major. v2 → v4 must pass
# through v3.4.9 on PG17. Stdout: image tag, rc 1 if nothing to stage.
compat_zitadel_next_stage_tag() {
    local current_major="$1" target_major="$2"
    if [ -z "$current_major" ] || [ "$current_major" -ge "$target_major" ]; then
        return 1
    fi
    if [ "$current_major" -lt 3 ] && [ "$target_major" -ge 4 ]; then
        printf '%s' "${ZITADEL_STAGE_VERSION:-v3.4.9}"
        return 0
    fi
    return 1
}

# Postgres image tag to pair with a Zitadel stage. v3.4.9 mandates PG17.
compat_zitadel_stage_pg_tag() {
    local zitadel_stage="$1"
    case "$zitadel_stage" in
        v3.*) printf '%s' "postgres:${ZITADEL_STAGE_POSTGRES_VERSION:-17-alpine}" ;;
        *)    printf '%s' "postgres:${ZITADEL_POSTGRES_VERSION:-18.3-alpine3.23}" ;;
    esac
}

compat_prepare_legacy_app_update() {
    local deploy_dir="$1"
    local runtime_env="$deploy_dir/state/fm-runtime.env"
    local legacy_oidc_env="$deploy_dir/state/fm-oidc.env"

    if [ ! -f "$runtime_env" ] && [ -f "$legacy_oidc_env" ]; then
        echo "[compat] legacy OIDC env detected; copying fm-oidc.env to fm-runtime.env for app-first update" >&2
        cp "$legacy_oidc_env" "$runtime_env" || return 1
        chmod 0600 "$runtime_env"
    fi
}
