# shellcheck shell=bash
# Migration planner. Given the running stack's state + the target versions,
# emit an ordered list of steps the orchestrator needs to execute.
#
# Each step is a single line: `<kind>\t<service>\t<from>\t<to>\t<note>`.
# Kinds:
#   pg_major_dump_restore  PG major bump for a DB service — dump, drop volume, fresh init, restore.
#   ts_extension_update    Timescale extension drift — ALTER EXTENSION UPDATE in place.
#   image_in_place         Same-or-minor image bump — restart picks up the new tag.
#   zitadel_setup          Zitadel image change at the final target — re-run bootstrap so setup phase runs.
#   zitadel_stage          Intermediate hop on a multi-major Zitadel migration (v2 -> v3.4.9 -> v4).
#   fm_rebuild             FM source/image change — rebuild + restart.
#   tenant_recreate        Per-client container (SaaS multi-tenant) — recreate at new tag.
#   noop                   Already at target or service not deployed — no action.

# Discover the running image tag of a service container. Empty when stopped.
mp_running_image_tag() {
    local project="$1" service="$2" id
    id="$(compat_service_container_id "$project" "$service" 2>/dev/null || true)"
    [ -n "$id" ] || return 0
    local image
    image="$(compat_container_image "$id")"
    printf '%s' "${image##*:}"
}

# Classify how a (service, current_tag, target_tag) transitions.
mp_classify() {
    local kind="$1" service="$2" current="$3" target="$4"
    case "$kind" in
        pg)
            # Target may be empty when env var isn't set — treat as noop.
            if [ -z "$target" ] || [ "${target##*:}" = "" ]; then
                printf 'noop\t%s\t%s\t%s\t\n' "$service" "$current" "$target"
                return 0
            fi
            local current_major target_major
            current_major="$(compat_postgres_major_from_tag "${current##*:}" 2>/dev/null || true)"
            target_major="$(compat_postgres_major_from_tag "${target##*:}" 2>/dev/null || true)"
            if [ -z "$current" ]; then
                # Not deployed — fresh installs are handled by `up`, not `migrate`.
                printf 'noop\t%s\t%s\t%s\tnot deployed\n' "$service" "$current" "$target"
            elif [ -z "$current_major" ] || [ "$current_major" = "$target_major" ]; then
                if [ "${current##*:}" = "${target##*:}" ]; then
                    printf 'noop\t%s\t%s\t%s\t\n' "$service" "$current" "$target"
                else
                    printf 'image_in_place\t%s\t%s\t%s\t\n' "$service" "$current" "$target"
                fi
            else
                printf 'pg_major_dump_restore\t%s\t%s\t%s\tPG %s → %s\n' \
                    "$service" "$current" "$target" "$current_major" "$target_major"
            fi
            ;;
        zitadel)
            if [ -z "$target" ]; then
                printf 'noop\t%s\t%s\t%s\t\n' "$service" "$current" "$target"
            elif [ -z "$current" ] || [ "$current" = "$target" ]; then
                printf 'noop\t%s\t%s\t%s\t\n' "$service" "$current" "$target"
            else
                printf 'zitadel_setup\t%s\t%s\t%s\tre-run Zitadel bootstrap\n' \
                    "$service" "$current" "$target"
            fi
            ;;
        image)
            if [ -z "$target" ] || [ "${target##*:}" = "" ]; then
                printf 'noop\t%s\t%s\t%s\t\n' "$service" "$current" "$target"
            elif [ -z "$current" ]; then
                # Service not currently running — skip; let `up` start it.
                printf 'noop\t%s\t%s\t%s\tnot deployed\n' "$service" "$current" "$target"
            elif [ "$current" = "$target" ] || [ "${current##*:}" = "${target##*:}" ]; then
                printf 'noop\t%s\t%s\t%s\t\n' "$service" "$current" "$target"
            else
                printf 'image_in_place\t%s\t%s\t%s\t\n' "$service" "$current" "$target"
            fi
            ;;
        fm)
            if [ -z "$target" ]; then
                printf 'noop\t%s\t%s\t%s\t\n' "$service" "$current" "$target"
            elif [ -z "$current" ]; then
                # No app container and no caller-provided DB context means there
                # is nothing to migrate. Fresh installs are handled by `up`.
                printf 'noop\t%s\t%s\t%s\tnot deployed\n' "$service" "$current" "$target"
            else
                printf 'fm_rebuild\t%s\t%s\t%s\t\n' "$service" "$current" "$target"
            fi
            ;;
    esac
}

# Compose the full plan for the current stack. Reads target versions from the
# environment (sourced from VERSIONS.env) and the running images.
mp_build_plan() {
    local project="${COMPOSE_PROJECT_NAME:-fm}"
    local fleet_db_current fleet_manager_current
    # Storage — TimescaleDB PG major is destructive (dump+restore).
    fleet_db_current="$(mp_running_image_tag "$project" fleet-db)"
    mp_classify pg fleet-db \
        "$fleet_db_current" \
        "timescale/timescaledb:${TIMESCALEDB_VERSION:-}"
    # Zitadel api + db — may emit multi-hop staging for v2 → v4 jumps.
    mp_emit_zitadel_steps "$project"
    # Adjacent services — same-major bumps in place, warn on major drift.
    mp_classify image redis \
        "$(mp_running_image_tag "$project" redis)" \
        "redis:${REDIS_VERSION:-7.4.2-alpine}"
    mp_classify image grafana \
        "$(mp_running_image_tag "$project" grafana)" \
        "grafana/grafana-oss:${GRAFANA_VERSION:-}"
    mp_classify image nodered \
        "$(mp_running_image_tag "$project" nodered)" \
        "nodered/node-red:${NODE_RED_VERSION:-latest}"
    mp_classify image traefik \
        "$(mp_running_image_tag "$project" traefik)" \
        "traefik:${TRAEFIK_VERSION:-}"
    mp_classify image dozzle \
        "$(mp_running_image_tag "$project" dozzle)" \
        "amir20/dozzle:${DOZZLE_VERSION:-v10.4.1}"
    mp_classify image mailcatcher \
        "$(mp_running_image_tag "$project" mailcatcher)" \
        "haravich/fake-smtp-server:${MAILCATCHER_VERSION:-}"
    mp_classify image mdns-repeater \
        "$(mp_running_image_tag "$project" mdns-repeater)" \
        "shellygroup/mdns-repeater:${MDNS_REPEATER_VERSION:-}"
    # Fleet Manager — rebuild + restart. DB migrations run on boot.
    fleet_manager_current="$(mp_running_image_tag "$project" fleet-manager)"
    if [ -z "$fleet_manager_current" ] && [ -n "$fleet_db_current" ]; then
        printf 'fm_rebuild\t%s\t%s\t%s\tstart target service\n' \
            "fleet-manager" "$fleet_manager_current" "${FM_VERSION:-latest}"
    else
        mp_classify fm fleet-manager \
            "$fleet_manager_current" \
            "${FM_VERSION:-latest}"
    fi
    # Per-tenant Node-RED + Grafana (SaaS only). Recreates each running tenant
    # container so it picks up the bumped image. Noop when not multi-tenant.
    mp_emit_tenant_steps "$project"
    # Tail — Timescale extension drift detected at runtime against the new image.
    mp_emit_extension_step fleet-db
}

mp_scheme_from_external_secure() {
    case "${1:-false}" in
        true|1|yes) printf 'https' ;;
        *)          printf 'http' ;;
    esac
}

# Enumerate per-tenant containers (Node-RED + Grafana) and emit a recreate
# step for each one whose running image differs from the target. The infra
# bumps to FM/Zitadel/etc. don't reach tenant compose stacks — they need
# their own `up -d --no-deps` pass per service per tenant.
mp_emit_tenant_steps() {
    local project="$1"
    local client_dir="${CLIENT_DIR:-${DEPLOY_DIR:-}/clients}"
    [ -d "$client_dir" ] || return 0
    local env_file cid current target
    for env_file in "$client_dir"/*.env; do
        [ -f "$env_file" ] || continue
        cid="$(awk -F= '$1 == "CLIENT_ID" { print $2; exit }' "$env_file")"
        [ -n "$cid" ] || continue
        # Node-RED
        current="$(mp_running_image_tag "${project}-${cid}" nodered)"
        target="${NODE_RED_IMAGE:-nodered/node-red:${NODE_RED_VERSION:-latest}}"
        mp_emit_tenant_recreate "$cid" nodered "$current" "$target"
        # Grafana
        current="$(mp_running_image_tag "${project}-${cid}" grafana)"
        target="grafana/grafana-oss:${GRAFANA_VERSION:-}"
        mp_emit_tenant_recreate "$cid" grafana "$current" "$target"
    done
}

# Emit a tenant_recreate row when there's actual drift; otherwise noop.
mp_emit_tenant_recreate() {
    local cid="$1" service="$2" current="$3" target="$4"
    if [ -z "$current" ] || [ -z "$target" ] || [ "${target##*:}" = "" ]; then
        printf 'noop\t%s\t%s\t%s\ttenant=%s; not deployed or no target\n' \
            "$service" "$current" "$target" "$cid"
        return 0
    fi
    if [ "$current" = "$target" ] || [ "${current##*:}" = "${target##*:}" ]; then
        printf 'noop\t%s\t%s\t%s\ttenant=%s\n' "$service" "$current" "$target" "$cid"
        return 0
    fi
    printf 'tenant_recreate\t%s\t%s\t%s\ttenant=%s\n' \
        "$service" "$current" "$target" "$cid"
}

# Staged Zitadel migration: when the running Zitadel is several majors behind
# the target, emit a chain of (pg-hop, zitadel-stage) pairs before the final
# (pg-hop, zitadel-setup) pair. v3 requires PG17 (its 34_add_cache_schema
# migration uses UNLOGGED partitioned tables, removed in PG18).
mp_emit_zitadel_steps() {
    local project="$1"
    local current_zitadel target_zitadel current_pg target_pg
    current_zitadel="$(mp_running_image_tag "$project" zitadel-api)"
    target_zitadel="${ZITADEL_VERSION:-}"
    current_pg="$(mp_running_image_tag "$project" zitadel-db)"
    target_pg="postgres:${ZITADEL_POSTGRES_VERSION:-}"

    local target_major
    target_major="$(compat_zitadel_major_from_tag "$target_zitadel" 2>/dev/null || true)"
    local current_pg_major target_pg_major
    current_pg_major="$(compat_postgres_major_from_tag "${current_pg##*:}" 2>/dev/null || true)"
    target_pg_major="$(compat_postgres_major_from_tag "${target_pg##*:}" 2>/dev/null || true)"

    # Existing DB but missing/stopped API container: fail safe by running the
    # target ZITADEL setup on the current PostgreSQL major before any PG hop.
    if [ -z "$current_zitadel" ] \
        && [ -n "$current_pg" ] \
        && [ -n "$target_zitadel" ] \
        && [ -n "$current_pg_major" ] \
        && [ -n "$target_pg_major" ] \
        && [ "$current_pg_major" != "$target_pg_major" ]; then
        printf 'zitadel_setup\tzitadel-api\tunknown\t%s\trun target setup before PG major hop\n' \
            "$target_zitadel"
        current_zitadel="$target_zitadel"
    fi

    # Walk intermediate stages, if any. Each pass advances current_zitadel /
    # current_pg through one approved hop.
    if [ -n "$current_zitadel" ] && [ -n "$target_major" ]; then
        local cursor_major next_stage stage_pg
        while :; do
            cursor_major="$(compat_zitadel_major_from_tag "$current_zitadel" 2>/dev/null || true)"
            [ -n "$cursor_major" ] || break
            next_stage="$(compat_zitadel_next_stage_tag "$cursor_major" "$target_major" 2>/dev/null || true)"
            [ -n "$next_stage" ] || break
            stage_pg="$(compat_zitadel_stage_pg_tag "$next_stage")"
            # PG hop paired with this stage.
            mp_classify pg zitadel-db "$current_pg" "$stage_pg"
            # Intermediate Zitadel stage. The PG tag travels alongside in the
            # note so the orchestrator can override compose env for this step.
            printf 'zitadel_stage\tzitadel-api\t%s\t%s\tpg=%s; intermediate hop\n' \
                "$current_zitadel" "$next_stage" "$stage_pg"
            current_zitadel="$next_stage"
            current_pg="$stage_pg"
        done
    fi

    if [ -n "$current_zitadel" ] \
        && [ -n "$target_zitadel" ] \
        && [ "$current_zitadel" != "$target_zitadel" ] \
        && [ -n "$current_pg_major" ] \
        && [ -n "$target_pg_major" ] \
        && [ "$current_pg_major" != "$target_pg_major" ]; then
        printf 'zitadel_setup\tzitadel-api\t%s\t%s\trun target setup before PG major hop\n' \
            "$current_zitadel" "$target_zitadel"
        current_zitadel="$target_zitadel"
    fi

    # Final DB hop, then ensure the target Zitadel API is running afterwards.
    mp_classify pg zitadel-db "$current_pg" "$target_pg"
    if [ "$current_zitadel" = "$target_zitadel" ] \
        && [ -n "$current_pg_major" ] \
        && [ -n "$target_pg_major" ] \
        && [ "$current_pg_major" != "$target_pg_major" ]; then
        printf 'zitadel_setup\tzitadel-api\t%s\t%s\trestart after PG major hop\n' \
            "$target_zitadel" "$target_zitadel"
    elif [ "$current_zitadel" != "$target_zitadel" ]; then
        mp_classify zitadel zitadel-api "$current_zitadel" "$target_zitadel"
    else
        mp_emit_zitadel_topology_setup "$current_zitadel" "$target_zitadel"
    fi
}

mp_emit_zitadel_topology_setup() {
    local current_zitadel="$1" target_zitadel="$2"
    [ -n "$current_zitadel" ] || return 0
    [ -n "$target_zitadel" ] || return 0

    local target_host target_port target_secure target_scheme target_tls
    target_host="${ZITADEL_HOSTNAME:-}"
    target_port="${ZITADEL_EXTERNALPORT:-}"
    target_secure="${ZITADEL_EXTERNALSECURE:-false}"
    target_scheme="${ZITADEL_PUBLIC_SCHEME:-$(mp_scheme_from_external_secure "$target_secure")}"
    target_tls="${ZITADEL_TLS_MODE:-}"
    [ -n "$target_host" ] || return 0

    if [ -z "${DEPLOY_ZITADEL_HOSTNAME:-}${DEPLOY_ZITADEL_EXTERNALPORT:-}${DEPLOY_ZITADEL_EXTERNALSECURE:-}${DEPLOY_ZITADEL_PUBLIC_SCHEME:-}${DEPLOY_ZITADEL_TLS_MODE:-}" ]; then
        [ -n "${DEPLOY_ENV:-}${DEPLOY_LAST_COMMAND:-}" ] || return 0
        printf 'zitadel_setup\tzitadel-api\t%s\t%s\treconcile external URL metadata\n' \
            "$current_zitadel" "$target_zitadel"
        return 0
    fi

    local prior_scheme
    prior_scheme="${DEPLOY_ZITADEL_PUBLIC_SCHEME:-$(mp_scheme_from_external_secure "${DEPLOY_ZITADEL_EXTERNALSECURE:-false}")}"
    if [ "${DEPLOY_ZITADEL_HOSTNAME:-}" != "$target_host" ] \
        || [ "${DEPLOY_ZITADEL_EXTERNALPORT:-}" != "$target_port" ] \
        || [ "${DEPLOY_ZITADEL_EXTERNALSECURE:-false}" != "$target_secure" ] \
        || [ "$prior_scheme" != "$target_scheme" ] \
        || [ "${DEPLOY_ZITADEL_TLS_MODE:-}" != "$target_tls" ]; then
        printf 'zitadel_setup\tzitadel-api\t%s\t%s\treconcile external URL config\n' \
            "$current_zitadel" "$target_zitadel"
    fi
}

# Timescale extension drift is checked at runtime — emitted as a tail step
# so the orchestrator runs ALTER EXTENSION after the new image is up.
mp_emit_extension_step() {
    local service="$1" project="${COMPOSE_PROJECT_NAME:-fm}" target
    [ -n "$(mp_running_image_tag "$project" "$service")" ] || return 0
    target="$(compat_timescale_version_from_tag "${TIMESCALEDB_VERSION:-}" 2>/dev/null || true)"
    [ -n "$target" ] || return 0
    printf 'ts_extension_update\t%s\t\t%s\t\n' "$service" "$target"
}

# Human-readable plan, one line per step.
mp_print_plan() {
    local plan="$1"
    if [ -z "$plan" ] || ! printf '%s\n' "$plan" | awk -F'\t' '
        $1 != "noop" { found = 1 }
        END { exit found ? 0 : 1 }
    '; then
        echo "  (no changes — stack matches target versions)"
        return 0
    fi
    printf '%s\n' "$plan" | awk -F'\t' '
        $1 == "noop" { next }
        {
            note = ($5 == "") ? "" : "  — " $5
            printf "  %-22s %-15s %s → %s%s\n", $1, $2, ($3 == "" ? "(none)" : $3), $4, note
        }
    '
}
