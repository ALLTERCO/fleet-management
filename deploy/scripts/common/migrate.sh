# shellcheck shell=bash
# Shared old → new migration orchestrator.
#
# Walks the plan from migrate-plan.sh and applies each step with a rollback
# marker. Any failure restores from the immediately-prior snapshot and
# leaves the stack in the last known-good state.
#
# Supports three classes of starting point:
#   1. Ancient   — Zitadel v2 + PG16 + old FM. Stages v2 → v3.4.9 (PG17) → v4 (PG18).
#   2. Mid       — old Zitadel v2/v3, modern FM. Stages via v3.4.9 as needed.
#   3. Near-target — Zitadel v4 + PG18 + recent FM. Image-in-place + FM rebuild.
#
# CLI adapters live in the private and public command trees. They provide
# environment-specific logging, compose, Zitadel, and FM image operations used
# by this engine.

cmd_migrate_engine() {
    : "${ENV_NAME:?ENV_NAME not set}"
    : "${DEPLOY_DIR:?DEPLOY_DIR not set}"
    : "${COMPOSE_PROJECT_NAME:=fm}"

    local dry_run="${MIGRATE_DRY_RUN:-false}"
    local plan_only="${MIGRATE_PLAN_ONLY:-false}"
    local lock_file="${MIGRATE_LOCK_FILE:-$DEPLOY_DIR/state/migrate.lock}"
    local fleet_db="${POSTGRES_DB:-fleet}"
    local fleet_user="${POSTGRES_USER:-postgres}"
    local zitadel_db="${ZITADEL_POSTGRES_DB:-zitadel}"
    local zitadel_user="${ZITADEL_POSTGRES_USER:-postgres}"

    mg_acquire_lock "$lock_file" || return 1

    log_info "Reading current stack state..."
    local plan
    plan="$(mp_build_plan)"

    local inventory_path
    inventory_path="$(mg_inventory_snapshot)" || {
        mg_release_lock "$lock_file"
        return 1
    }
    log_info "Inventory snapshot: $inventory_path"

    log_info "Migration plan:"
    mp_print_plan "$plan"
    local report_path
    report_path="$(mg_report_start "$plan")" || {
        mg_release_lock "$lock_file"
        return 1
    }
    mg_report_set_inventory "$report_path" "$inventory_path" || return 1
    log_info "Migration report: $report_path"

    if [ "$plan_only" = "true" ]; then
        mg_report_finish "$report_path" plan_only ""
        mg_release_lock "$lock_file"
        return 0
    fi

    if ! mg_plan_has_work "$plan"; then
        log_info "Stack already at target — nothing to do."
        mg_report_finish "$report_path" noop ""
        mg_release_lock "$lock_file"
        return 0
    fi

    if [ "$dry_run" = "true" ]; then
        log_info "--dry-run set; not executing."
        mg_report_finish "$report_path" dry_run ""
        mg_release_lock "$lock_file"
        return 0
    fi

    mg_confirm_plan "$plan" || {
        mg_report_finish "$report_path" failed "operator confirmation"
        mg_release_lock "$lock_file"
        return 1
    }

    mg_prepare_current_runtime_state || {
        mg_report_finish "$report_path" failed "prepare current runtime state"
        mg_release_lock "$lock_file"
        return 1
    }

    mg_preflight "$plan" || {
        mg_report_finish "$report_path" failed "preflight"
        mg_release_lock "$lock_file"
        return 1
    }

    log_info "Snapshotting databases before migration..."
    local fleet_snapshot zitadel_snapshot
    fleet_snapshot="$(mg_snapshot fleet-db "$fleet_db" "$fleet_user" migrate-fleet)" || {
        mg_report_finish "$report_path" failed "snapshot fleet-db"
        mg_release_lock "$lock_file"
        return 1
    }
    zitadel_snapshot="$(mg_snapshot zitadel-db "$zitadel_db" "$zitadel_user" migrate-zitadel)" || {
        mg_report_finish "$report_path" failed "snapshot zitadel-db"
        mg_release_lock "$lock_file"
        return 1
    }
    mg_verify_restore_drills "$plan" "$fleet_snapshot" "$zitadel_snapshot" || {
        mg_report_finish "$report_path" failed "restore drill"
        mg_release_lock "$lock_file"
        return 1
    }

    log_info "Capturing pre-migration upgrade-audit snapshots..."
    local fleet_audit_pre zitadel_audit_pre
    fleet_audit_pre="$(mg_audit_snapshot fleet fleet-db "$fleet_db" "$fleet_user" pre-migrate)" || {
        mg_report_finish "$report_path" failed "audit snapshot fleet-db"
        mg_release_lock "$lock_file"
        return 1
    }
    zitadel_audit_pre="$(mg_audit_snapshot zitadel zitadel-db "$zitadel_db" "$zitadel_user" pre-migrate)" || {
        mg_report_finish "$report_path" failed "audit snapshot zitadel-db"
        mg_release_lock "$lock_file"
        return 1
    }
    mg_report_update_artifacts "$report_path" \
        "$fleet_snapshot" "$zitadel_snapshot" "$fleet_audit_pre" "$zitadel_audit_pre" || {
        mg_report_finish "$report_path" failed "report artifacts"
        mg_release_lock "$lock_file"
        return 1
    }

    log_info "Executing plan..."
    MG_ROLLBACK_FLEET_DB_TAG="$(mp_running_image_tag "$COMPOSE_PROJECT_NAME" fleet-db)"
    MG_ROLLBACK_ZITADEL_DB_TAG="$(mp_running_image_tag "$COMPOSE_PROJECT_NAME" zitadel-db)"
    local step
    while IFS= read -r step; do
        [ -z "$step" ] && continue
        case "${step%%$'\t'*}" in
            noop) ;;
            *) mg_run_step "$step" "$fleet_snapshot" "$zitadel_snapshot" || {
                log_error "Step failed: $step"
                log_error "Rolling back to pre-migration snapshots..."
                mg_rollback "$fleet_snapshot" "$zitadel_snapshot"
                mg_report_finish "$report_path" failed "$step"
                mg_release_lock "$lock_file"
                return 1
            } ;;
        esac
    done <<<"$plan"

    log_info "Verifying health..."
    mg_health_gate || {
        log_error "Health gate failed after migration — rolling back."
        mg_rollback "$fleet_snapshot" "$zitadel_snapshot"
        mg_report_finish "$report_path" failed "health gate"
        mg_release_lock "$lock_file"
        return 1
    }

    log_info "Verifying post-migration semantic health..."
    mg_semantic_verify || {
        log_error "Semantic verification failed after migration — rolling back."
        mg_rollback "$fleet_snapshot" "$zitadel_snapshot"
        mg_report_finish "$report_path" failed "semantic verification"
        mg_release_lock "$lock_file"
        return 1
    }

    log_info "Verifying post-migration data invariants..."
    mg_verify_audits "$fleet_audit_pre" "$zitadel_audit_pre" || {
        log_error "Upgrade-audit invariants failed after migration — rolling back."
        mg_rollback "$fleet_snapshot" "$zitadel_snapshot"
        mg_report_finish "$report_path" failed "upgrade audit"
        mg_release_lock "$lock_file"
        return 1
    }

    mg_record_deploy_meta_after_success || {
        mg_report_finish "$report_path" failed "record deploy metadata"
        mg_release_lock "$lock_file"
        return 1
    }
    mg_report_finish "$report_path" success ""
    mg_release_lock "$lock_file"
    log_info "Migration complete. Stack now matches target versions."
}

mg_import_legacy_machinekey() {
    local target="$DEPLOY_DIR/state/machinekey/zitadel-admin-sa.json"
    local source=""

    source="$(mg_legacy_container_machinekey_path || true)"
    if [ -z "$source" ] && [ ! -f "$target" ]; then
        source="$DEPLOY_DIR/../machinekey/zitadel-admin-sa.json"
    fi

    [ -n "$source" ] || return 0
    [ -f "$source" ] || return 0
    mkdir -p "$(dirname "$target")" || return 1
    if [ -f "$target" ] && cmp -s "$source" "$target"; then
        chmod 0600 "$target" 2>/dev/null || true
        if declare -F log_info >/dev/null 2>&1; then
            log_info "Reusing existing Zitadel machinekey from $source"
        fi
        return 0
    fi
    cp "$source" "$target" || return 1
    chmod 0600 "$target" 2>/dev/null || true
    if declare -F log_info >/dev/null 2>&1; then
        log_info "Imported legacy Zitadel machinekey from $source"
    fi
}

mg_legacy_container_machinekey_path() {
    local name id path
    for name in \
        "zitadel-fleet-management" \
        "${COMPOSE_PROJECT_NAME:-fm}-zitadel-1" \
        "${COMPOSE_PROJECT_NAME:-fm}-zitadel-api-1"; do
        id="$(docker ps -aq --filter "name=^${name}$" 2>/dev/null | head -1 || true)"
        [ -n "$id" ] || continue
        path="$(mg_container_machinekey_path "$id" || true)"
        [ -n "$path" ] || continue
        printf '%s\n' "$path"
        return 0
    done
    return 1
}

mg_container_machinekey_path() {
    local id="$1" source_dir
    source_dir="$(docker inspect "$id" 2>/dev/null |
        jq -r '.[0].Mounts[]? | select(.Destination == "/machinekey") | .Source' |
        head -1)"
    [ -n "$source_dir" ] || return 1
    printf '%s\n' "$source_dir/zitadel-admin-sa.json"
}

mg_record_deploy_meta_after_success() {
    if declare -F write_deploy_meta >/dev/null 2>&1; then
        write_deploy_meta
        return $?
    fi
    if declare -F save_deploy_meta >/dev/null 2>&1; then
        save_deploy_meta "${ZITADEL_HOSTNAME:-${DEPLOY_HOSTNAME:-localhost}}" migrate
        return $?
    fi
    return 0
}

mg_acquire_lock() {
    local lock_file="$1"
    mkdir -p "$(dirname "$lock_file")" || return 1
    local now boot existing_pid existing_boot existing_ts
    now="$(date +%s)"
    boot="$(stat -c %Y /proc/1 2>/dev/null || echo 0)"
    if [ -e "$lock_file" ]; then
        IFS=$'\t' read -r existing_pid existing_boot existing_ts <"$lock_file" 2>/dev/null || true
        if [ "$existing_boot" = "$boot" ] \
            && [ -n "$existing_pid" ] \
            && kill -0 "$existing_pid" 2>/dev/null \
            && [ -n "$existing_ts" ] \
            && [ $((now - existing_ts)) -lt 21600 ]; then
            log_error "Migration/update already running (lock: $lock_file, pid: $existing_pid)"
            return 1
        fi
        rm -f "$lock_file"
    fi
    printf '%s\t%s\t%s\n' "$$" "$boot" "$now" >"$lock_file" || return 1
}

mg_release_lock() {
    local lock_file="$1"
    [ -n "$lock_file" ] && rm -f "$lock_file"
}

mg_inventory_snapshot() {
    local dir="${MIGRATION_INVENTORY_DIR:-$DEPLOY_DIR/state/migration-inventory}"
    mkdir -p "$dir" || return 1
    local path
    path="$(mktemp "$dir/inventory-${ENV_NAME:-unknown}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")" || return 1
    jq -n \
        --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg env "${ENV_NAME:-}" \
        --arg project "${COMPOSE_PROJECT_NAME:-fm}" \
        --arg envHash "$(mg_file_sha "$DEPLOY_DIR/env/${ENV_NAME:-}.env")" \
        --arg stateEnvHash "$(mg_file_sha "$DEPLOY_DIR/state/.env")" \
        --argjson containers "$(mg_containers_json)" \
        --argjson volumes "$(mg_volumes_json)" \
        --argjson fleetDb "$(mg_db_summary_json fleet-db "${POSTGRES_DB:-fleet}" "${POSTGRES_USER:-postgres}")" \
        --argjson zitadelDb "$(mg_db_summary_json zitadel-db "${ZITADEL_POSTGRES_DB:-zitadel}" "${ZITADEL_POSTGRES_USER:-postgres}")" \
        '{
            schemaVersion: "1",
            kind: "fleet-manager-migration-inventory",
            createdAt: $createdAt,
            environment: {name: $env, composeProject: $project},
            envHashes: {configured: $envHash, state: $stateEnvHash},
            containers: $containers,
            volumes: $volumes,
            databases: {fleet: $fleetDb, zitadel: $zitadelDb}
        }' > "$path" || return 1
    chmod 0600 "$path"
    printf '%s\n' "$path"
}

mg_file_sha() {
    local path="$1"
    [ -f "$path" ] || { printf ''; return 0; }
    bk_checksum "$path" 2>/dev/null || printf ''
}

mg_containers_json() {
    docker ps -a --filter "name=^${COMPOSE_PROJECT_NAME:-fm}-" \
        --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null |
        jq -R -s 'split("\n") | map(select(length > 0)) | map(split("\t") as $p | {name: $p[0], image: $p[1], status: $p[2]})'
}

mg_volumes_json() {
    docker volume ls --filter "name=^${COMPOSE_PROJECT_NAME:-fm}_" --format '{{.Name}}' 2>/dev/null |
        jq -R -s 'split("\n") | map(select(length > 0))'
}

mg_db_summary_json() {
    local service="$1" db_name="$2" db_user="$3"
    if ! compat_service_container_id "$COMPOSE_PROJECT_NAME" "$service" >/dev/null 2>&1; then
        jq -n --arg service "$service" --arg db "$db_name" '{service: $service, name: $db, deployed: false}'
        return 0
    fi
    local version tables
    version="$(ua_psql "$service" "$db_name" "$db_user" "SELECT current_setting('server_version');" 2>/dev/null || true)"
    tables="$(ua_psql "$service" "$db_name" "$db_user" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');" 2>/dev/null || echo "")"
    jq -n --arg service "$service" --arg db "$db_name" --arg version "$version" --arg tables "$tables" \
        '{service: $service, name: $db, deployed: true, postgresVersion: $version, tableCount: (if $tables == "" then null else ($tables | tonumber) end)}'
}

mg_report_start() {
    local plan="$1"
    local dir="${MIGRATION_REPORT_DIR:-$DEPLOY_DIR/state/migration-reports}"
    mkdir -p "$dir" || return 1
    local path plan_json
    path="$(mktemp "$dir/migrate-${ENV_NAME:-unknown}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")" || return 1
    plan_json="$(mg_plan_json "$plan")" || return 1
    jq -n \
        --arg schemaVersion "1" \
        --arg kind "fleet-manager-migration-report" \
        --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg env "${ENV_NAME:-}" \
        --arg project "${COMPOSE_PROJECT_NAME:-fm}" \
        --arg buildCommit "${FM_BUILD_COMMIT:-${GIT_COMMIT:-}}" \
        --argjson plan "$plan_json" \
        '{
            schemaVersion: $schemaVersion,
            kind: $kind,
            createdAt: $createdAt,
            completedAt: null,
            status: "running",
            environment: {name: $env, composeProject: $project},
            build: {commit: $buildCommit},
            plan: $plan,
            artifacts: {
                backups: {},
                auditSnapshots: {}
            },
            failure: null
        }' > "$path" || return 1
    chmod 0600 "$path"
    printf '%s\n' "$path"
}

mg_report_set_inventory() {
    local report_path="$1" inventory_path="$2"
    local tmp
    tmp="$(mktemp "${report_path}.XXXXXX")" || return 1
    jq --arg inventory "$inventory_path" '.artifacts.inventory = $inventory' "$report_path" > "$tmp" || {
        rm -f "$tmp"
        return 1
    }
    chmod 0600 "$tmp"
    mv "$tmp" "$report_path"
}

mg_plan_json() {
    local plan="$1"
    printf '%s\n' "$plan" | jq -R -s '
        split("\n")
        | map(select(length > 0))
        | map(split("\t") as $p | {
            kind: ($p[0] // ""),
            service: ($p[1] // ""),
            from: ($p[2] // ""),
            to: ($p[3] // ""),
            note: ($p[4] // "")
        })
    '
}

mg_plan_is_dangerous() {
    local plan="$1"
    printf '%s\n' "$plan" | awk -F'\t' '
        $1 == "pg_major_dump_restore" || $1 == "zitadel_stage" || $1 == "zitadel_setup" { found = 1 }
        END { exit found ? 0 : 1 }
    '
}

mg_confirm_plan() {
    local plan="$1"
    mg_plan_is_dangerous "$plan" || return 0
    if [ "${MIGRATE_YES:-false}" = "true" ] || [ "${FORCE:-false}" = "true" ]; then
        return 0
    fi
    if [ -t 0 ]; then
        log_warn "Migration plan includes destructive/staged work."
        log_warn "Re-run with --yes to execute after reviewing the plan."
        return 1
    fi
    log_error "Migration requires --yes because the plan includes destructive/staged work."
    return 1
}

mg_should_verify_restore() {
    local plan="$1"
    case "${MIGRATE_VERIFY_RESTORE:-auto}" in
        1|true|yes|required|strict) return 0 ;;
        0|false|no|off) return 1 ;;
        auto) mg_plan_is_dangerous "$plan" ;;
        *) log_error "Unknown --verify-restore value: ${MIGRATE_VERIFY_RESTORE}"; return 2 ;;
    esac
}

mg_verify_restore_drills() {
    local plan="$1" fleet_snapshot="$2" zitadel_snapshot="$3"
    if ! mg_should_verify_restore "$plan"; then
        return 0
    fi
    log_info "Verifying backups with restore drill..."
    if [ -n "$fleet_snapshot" ]; then
        mg_restore_drill_any fleet-db "${POSTGRES_USER:-postgres}" "$fleet_snapshot" "migrate_fleet" || {
            log_error "Fleet DB restore drill failed."
            return 1
        }
        log_info "  ✓ fleet-db restore drill passed"
    fi
    if [ -n "$zitadel_snapshot" ]; then
        bk_restore_drill zitadel-db "${ZITADEL_POSTGRES_USER:-postgres}" "$zitadel_snapshot" "migrate_zitadel" || {
            log_error "Zitadel DB restore drill failed."
            return 1
        }
        log_info "  ✓ zitadel-db restore drill passed"
    fi
}

# Restore-drill a single dump file, or every database dump in a multi-tenant
# snapshot directory.
mg_restore_drill_any() {
    local service="$1" db_user="$2" snapshot="$3" label="$4"
    if [ -d "$snapshot" ]; then
        [ -f "$snapshot/databases.txt" ] || { log_error "Snapshot index missing: $snapshot/databases.txt"; return 1; }
        local name owner path
        while IFS=$'\t' read -r name owner path; do
            [ -n "$path" ] || continue
            bk_restore_drill "$service" "$db_user" "$path" "${label}_${name}" || return 1
        done <"$snapshot/databases.txt"
        return 0
    fi
    bk_restore_drill "$service" "$db_user" "$snapshot" "$label"
}

mg_report_update_artifacts() {
    local report_path="$1" fleet_backup="$2" zitadel_backup="$3" fleet_audit="$4" zitadel_audit="$5"
    local tmp
    tmp="$(mktemp "${report_path}.XXXXXX")" || return 1
    jq \
        --arg fleetBackup "$fleet_backup" \
        --arg zitadelBackup "$zitadel_backup" \
        --arg fleetBackupManifest "$([ -n "$fleet_backup" ] && bk_manifest_path "$fleet_backup" || true)" \
        --arg zitadelBackupManifest "$([ -n "$zitadel_backup" ] && bk_manifest_path "$zitadel_backup" || true)" \
        --arg fleetAudit "$fleet_audit" \
        --arg zitadelAudit "$zitadel_audit" \
        '.artifacts.backups.fleet = {path: $fleetBackup, manifest: $fleetBackupManifest}
         | .artifacts.backups.zitadel = {path: $zitadelBackup, manifest: $zitadelBackupManifest}
         | .artifacts.auditSnapshots.fleetPre = $fleetAudit
         | .artifacts.auditSnapshots.zitadelPre = $zitadelAudit' \
        "$report_path" > "$tmp" || {
            rm -f "$tmp"
            return 1
        }
    chmod 0600 "$tmp"
    mv "$tmp" "$report_path"
}

mg_report_finish() {
    local report_path="$1" status="$2" failure_step="$3"
    [ -n "$report_path" ] && [ -f "$report_path" ] || return 0
    local tmp
    tmp="$(mktemp "${report_path}.XXXXXX")" || return 1
    jq \
        --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg status "$status" \
        --arg failureStep "$failure_step" \
        '.completedAt = $completedAt
         | .status = $status
         | .failure = (if $failureStep == "" then null else {step: $failureStep} end)' \
        "$report_path" > "$tmp" || {
            rm -f "$tmp"
            return 1
        }
    chmod 0600 "$tmp"
    mv "$tmp" "$report_path"
}

# Plan is empty or all noop -> no work.
mg_plan_has_work() {
    local plan="$1"
    [ -z "$plan" ] && return 1
    printf '%s\n' "$plan" | awk -F'\t' '
        $1 != "noop" { found = 1 }
        END { exit found ? 0 : 1 }
    '
}

mg_compose() {
    if declare -F run_compose >/dev/null 2>&1; then
        run_compose "${ENV_FILE_ARGV[@]}" -- "${COMPOSE_FILE_ARGV[@]}" -- "$@"
        return $?
    fi
    if declare -F compose_cmd >/dev/null 2>&1; then
        compose_cmd "$@"
        return $?
    fi
    log_error "No compose adapter available for migrate."
    return 1
}

mg_compose_fm() {
    if declare -F run_compose >/dev/null 2>&1; then
        local -a env_args=("${ENV_FILE_ARGV[@]}")
        if [ -f "$DEPLOY_DIR/state/fm-runtime.env" ]; then
            env_args+=(--env-file "$DEPLOY_DIR/state/fm-runtime.env")
        fi
        run_compose "${env_args[@]}" -- "${COMPOSE_FILE_ARGV[@]}" -- "$@"
        return $?
    fi
    mg_compose "$@"
}

mg_generate_fm_runtime_config() {
    if declare -F generate_fm_config >/dev/null 2>&1; then
        generate_fm_config "${ZITADEL_HOSTNAME:-${DEPLOY_HOSTNAME:-localhost}}"
        return $?
    fi

    FM_HOSTNAME="${FM_HOSTNAME:-${ZITADEL_HOSTNAME:-localhost}}" \
        bash "$DEPLOY_DIR/scripts/common/generate-fm-config.sh" --mode zitadel --target docker
}

mg_prepare_fleet_db_for_app_boot() {
    local db_name="${POSTGRES_DB:-fleet}"
    local db_user="${POSTGRES_USER:-postgres}"
    local cid

    cid="$(compat_service_container_id "$COMPOSE_PROJECT_NAME" fleet-db)" || {
        log_error "fleet-db container not found; cannot prepare Fleet DB for app boot."
        return 1
    }

    docker exec -i "$cid" psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE SCHEMA IF NOT EXISTS migration;
SQL
}

# Pre-flight: docker reachable, backup dir writable, disk space, supported plan.
mg_preflight() {
    local plan="$1"
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon unreachable."
        return 1
    fi
    local backup_dir="${BACKUP_DIR:-$DEPLOY_DIR/state/backups}"
    mkdir -p "$backup_dir" || {
        log_error "Cannot write to backup dir: $backup_dir"
        return 1
    }
    if compat_service_container_id "$COMPOSE_PROJECT_NAME" fleet-db >/dev/null 2>&1; then
        bk_preflight_space fleet-db "${POSTGRES_DB:-fleet}" "${POSTGRES_USER:-postgres}" || return 1
    fi
    mg_preflight_supports_plan "$plan" || return 1
}

# Refuse jumps the planner can't safely stage.
mg_preflight_supports_plan() {
    local plan="$1"
    local running_zitadel running_major
    running_zitadel="$(mp_running_image_tag "$COMPOSE_PROJECT_NAME" zitadel-api)"
    [ -z "$running_zitadel" ] && return 0
    running_major="$(compat_zitadel_major_from_tag "$running_zitadel" 2>/dev/null || true)"
    [ -n "$running_major" ] || return 0
    if [ "$running_major" -lt 2 ]; then
        log_error "Running Zitadel ($running_zitadel) is below the supported migration floor (v2)."
        log_error "Upgrade manually to v2.x first, then re-run 'migrate'."
        return 1
    fi
    # Confirm any pg_major_dump_restore steps point at services we know.
    while IFS=$'\t' read -r kind service _ _ _; do
        [ "$kind" = "pg_major_dump_restore" ] || continue
        case "$service" in
            fleet-db|zitadel-db) ;;
            *) log_error "Unsupported PG service in plan: $service"; return 1 ;;
        esac
    done <<<"$plan"
    mg_preflight_timescale_bridge "$plan" || return 1
}

mg_preflight_timescale_bridge() {
    local plan="$1"
    printf '%s\n' "$plan" | awk -F'\t' '$1 == "pg_major_dump_restore" && $2 == "fleet-db" { found = 1 } END { exit found ? 0 : 1 }' || return 0
    local bridge_tag
    bridge_tag="$(mg_timescale_bridge_tag_for_running_fleet "${TIMESCALEDB_VERSION:-}" || true)"
    [ -n "$bridge_tag" ] || return 0
    if mg_image_available "$bridge_tag"; then
        log_info "Timescale bridge image available: $bridge_tag"
        return 0
    fi
    log_error "Unsupported Timescale/PostgreSQL combined hop."
    log_error "Need bridge image $bridge_tag so PostgreSQL can move first and TimescaleDB can upgrade after restore."
    return 1
}

mg_image_available() {
    local image="$1"
    docker image inspect "$image" >/dev/null 2>&1 || docker manifest inspect "$image" >/dev/null 2>&1
}

# Snapshot one DB. Returns the backup path on stdout, empty on missing service.
mg_snapshot() {
    local service="$1" db_name="$2" db_user="$3" label="$4"
    if ! compat_service_container_id "$COMPOSE_PROJECT_NAME" "$service" >/dev/null 2>&1; then
        log_warn "Service $service not running — skipping snapshot."
        echo ""
        return 0
    fi
    local path
    if [ "$service" = "fleet-db" ]; then
        # Shared cluster — snapshot every tenant database + global roles so a
        # rollback can restore all of them, not just the primary database.
        path="$(mg_dump_all_databases "$service" "$db_user" "$label")" || {
            log_error "Snapshot of $service failed."
            return 1
        }
    else
        path="$(bk_create_update_backup "$service" "$db_name" "$db_user" "" "" "$label")" || {
            log_error "Snapshot of $service failed."
            return 1
        }
    fi
    log_info "  ✓ $service snapshot → $path" >&2
    echo "$path"
}

mg_audit_snapshot() {
    local kind="$1" service="$2" db_name="$3" db_user="$4" label="$5"
    if ! compat_service_container_id "$COMPOSE_PROJECT_NAME" "$service" >/dev/null 2>&1; then
        echo ""
        return 0
    fi
    case "$kind" in
        fleet) ua_snapshot_fleet "$service" "$db_name" "$db_user" "$label" ;;
        zitadel) ua_snapshot_zitadel "$service" "$db_name" "$db_user" "$label" ;;
        *) log_error "Unknown audit snapshot kind: $kind"; return 1 ;;
    esac
}

mg_verify_audits() {
    local fleet_pre="$1" zitadel_pre="$2"
    local fleet_db="${POSTGRES_DB:-fleet}"
    local fleet_user="${POSTGRES_USER:-postgres}"
    local zitadel_db="${ZITADEL_POSTGRES_DB:-zitadel}"
    local zitadel_user="${ZITADEL_POSTGRES_USER:-postgres}"

    mg_verify_audit_pair fleet fleet-db "$fleet_db" "$fleet_user" "$fleet_pre" || return 1
    mg_verify_audit_pair zitadel zitadel-db "$zitadel_db" "$zitadel_user" "$zitadel_pre" || return 1
}

mg_verify_audit_pair() {
    local kind="$1" service="$2" db_name="$3" db_user="$4" pre_path="$5"
    [ -n "$pre_path" ] || return 0
    local post_path report_path
    post_path="$(mg_audit_snapshot "$kind" "$service" "$db_name" "$db_user" "post-migrate")" || return 1
    [ -n "$post_path" ] || {
        log_error "Service $service disappeared before post-migration audit."
        return 1
    }
    report_path="${UPGRADE_AUDIT_DIR:-$DEPLOY_DIR/state/upgrade-audits}/${kind}-migrate-compare-$(date -u +%Y%m%dT%H%M%SZ).json"
    if ua_compare_snapshots "$pre_path" "$post_path" "$report_path"; then
        log_info "  ✓ $service audit compare passed → $report_path"
        return 0
    fi
    log_error "$service audit compare failed → $report_path"
    return 1
}

mg_semantic_verify() {
    mg_verify_fleet_semantics || return 1
    mg_verify_zitadel_semantics || return 1
}

mg_verify_fleet_semantics() {
    local service="fleet-db" db_name="${POSTGRES_DB:-fleet}" db_user="${POSTGRES_USER:-postgres}"
    compat_service_container_id "$COMPOSE_PROJECT_NAME" "$service" >/dev/null 2>&1 || return 0
    mg_expect_table "$service" "$db_name" "$db_user" "device.list" || return 1
    mg_expect_table "$service" "$db_name" "$db_user" "organization.profile" || return 1
    mg_expect_table "$service" "$db_name" "$db_user" "user.list" || return 1
    mg_expect_no_rows "$service" "$db_name" "$db_user" "devices without org" \
        "SELECT COUNT(*) FROM device.list WHERE organization_id IS NULL;" || return 1
    mg_expect_no_rows "$service" "$db_name" "$db_user" "duplicate device external_id" "
        SELECT COUNT(*) FROM (
            SELECT external_id FROM device.list
            WHERE external_id IS NOT NULL
            GROUP BY external_id HAVING COUNT(*) > 1
        ) d;
    " || return 1
    if ua_table_exists "$service" "$db_name" "$db_user" "device.virtual_device_binding"; then
        mg_expect_no_rows "$service" "$db_name" "$db_user" "orphan virtual bindings" "
            SELECT COUNT(*)
            FROM device.virtual_device_binding b
            LEFT JOIN device.virtual_device v ON v.device_list_id = b.virtual_device_list_id
            WHERE v.device_list_id IS NULL;
        " || return 1
    fi
    if ua_table_exists "$service" "$db_name" "$db_user" "device.blu_transport"; then
        mg_expect_no_rows "$service" "$db_name" "$db_user" "orphan BLU transports" "
            SELECT COUNT(*)
            FROM device.blu_transport t
            LEFT JOIN device.blu_device b ON b.device_list_id = t.blu_device_list_id
            WHERE b.device_list_id IS NULL;
        " || return 1
    fi
    if ua_table_exists "$service" "$db_name" "$db_user" "notifications.delivery_jobs"; then
        mg_expect_no_rows "$service" "$db_name" "$db_user" "orphan notification delivery jobs" "
            SELECT COUNT(*)
            FROM notifications.delivery_jobs j
            LEFT JOIN notifications.channels e ON e.id = j.endpoint_id
            WHERE j.endpoint_id IS NOT NULL AND e.id IS NULL;
        " || return 1
    fi
}

mg_verify_zitadel_semantics() {
    local service="zitadel-db" db_name="${ZITADEL_POSTGRES_DB:-zitadel}" db_user="${ZITADEL_POSTGRES_USER:-postgres}"
    compat_service_container_id "$COMPOSE_PROJECT_NAME" "$service" >/dev/null 2>&1 || return 0
    local found=0 table_ref
    for table_ref in eventstore.events eventstore.events2 projections.current_states system.instances; do
        if ua_table_exists "$service" "$db_name" "$db_user" "$table_ref"; then
            found=1
        fi
    done
    if [ "$found" -ne 1 ]; then
        log_error "Zitadel semantic check failed: no known event/state tables found."
        return 1
    fi
    if ua_table_exists "$service" "$db_name" "$db_user" "projections.failed_events"; then
        mg_expect_no_rows "$service" "$db_name" "$db_user" "Zitadel failed projection events" \
            "SELECT COUNT(*) FROM projections.failed_events;" || return 1
    fi
}

mg_expect_table() {
    local service="$1" db_name="$2" db_user="$3" table_ref="$4"
    if ua_table_exists "$service" "$db_name" "$db_user" "$table_ref"; then
        return 0
    fi
    log_error "Semantic check failed: missing table $table_ref in $service/$db_name."
    return 1
}

mg_expect_no_rows() {
    local service="$1" db_name="$2" db_user="$3" label="$4" sql="$5"
    local count
    count="$(ua_query_count "$service" "$db_name" "$db_user" "$sql")" || return 1
    if [ "${count:-0}" = "0" ]; then
        return 0
    fi
    log_error "Semantic check failed: $label count=$count."
    return 1
}

# Dispatch one plan step. Step format: kind<TAB>service<TAB>from<TAB>to<TAB>note.
mg_run_step() {
    local step="$1" fleet_snapshot="$2" zitadel_snapshot="$3"
    local kind service from to note
    kind="$(printf '%s' "$step" | cut -f1)"
    service="$(printf '%s' "$step" | cut -f2)"
    from="$(printf '%s' "$step" | cut -f3)"
    to="$(printf '%s' "$step" | cut -f4)"
    note="$(printf '%s' "$step" | cut -f5)"
    log_info "[$kind] $service: ${from:-(none)} → $to"
    case "$kind" in
        pg_major_dump_restore) mg_step_pg_major "$service" "$to" ;;
        ts_extension_update)   mg_step_ts_extension "$service" ;;
        image_in_place)        mg_step_image_in_place "$service" "$to" ;;
        zitadel_stage)         mg_step_zitadel_stage "$to" "$note" ;;
        zitadel_setup)         mg_step_zitadel_setup "$note" ;;
        fm_rebuild)            mg_step_fm_rebuild ;;
        tenant_recreate)       mg_step_tenant_recreate "$service" "$note" ;;
        *) log_warn "Unknown step kind '$kind' — skipping." ;;
    esac
}

mg_prepare_current_runtime_state() {
    log_info "Preparing current runtime secrets and generated config..."

    if declare -F ensure_deploy_secrets >/dev/null 2>&1; then
        ensure_deploy_secrets "$DEPLOY_DIR" || return 1
    else
        migrate_legacy_secret_encryption_key
        generate_passwords || return 1
        if ! validate_no_demo_literals; then
            log_error "Refusing to migrate with demo / weak secrets in environment."
            return 1
        fi
        if ! validate_bootstrap_admin_passwords "${ENV_NAME:-${DEPLOY_ENV:-}}" >/dev/null 2>&1; then
            log_error "Refusing to migrate with weak bootstrap admin passwords."
            return 1
        fi
        if declare -F save_env >/dev/null 2>&1; then
            save_env || return 1
        elif declare -F save_deploy_state_env >/dev/null 2>&1; then
            save_deploy_state_env "$DEPLOY_DIR" || return 1
        else
            log_error "No deploy-state secret persistence function is available."
            return 1
        fi
    fi

    mg_import_legacy_machinekey || return 1
    mg_import_legacy_fm_local_volumes || return 1

    if declare -F generate_init_sql >/dev/null 2>&1; then
        generate_init_sql || return 1
    else
        bash "$DEPLOY_DIR/scripts/common/init-fleet-db.sh" || return 1
        bash "$DEPLOY_DIR/scripts/common/init-zitadel-db.sh" || return 1
    fi

    if declare -F generate_system_api_keypair >/dev/null 2>&1; then
        generate_system_api_keypair || return 1
    else
        bash "$DEPLOY_DIR/scripts/common/init-system-api.sh" || return 1
    fi

    bash "$DEPLOY_DIR/scripts/common/init-redis-acl.sh" || return 1
    bash "$DEPLOY_DIR/scripts/common/reload-redis-acl.sh" || return 1
}

mg_import_legacy_fm_local_volumes() {
    local suffix
    for suffix in \
        fm-backend-cfg-v \
        fm-backend-plugins-v \
        fm-backend-uploads-v \
        fm-backend-data-v; do
        mg_import_legacy_fm_local_volume "$suffix" || return 1
    done
}

mg_import_legacy_fm_local_volume() {
    local suffix="$1"
    local target="${COMPOSE_PROJECT_NAME:-fm}_${suffix}"
    local source=""

    source="$(mg_find_legacy_fm_volume "$suffix" "$target" || true)"
    [ -n "$source" ] || return 0

    if mg_volume_has_entries "$target"; then
        log_warn "Skipping legacy volume import for $suffix: target volume $target is not empty."
        return 0
    fi

    log_info "Importing legacy FM local volume $source → $target"
    docker volume create "$target" >/dev/null || return 1
    docker run --rm \
        -v "$source:/src:ro" \
        -v "$target:/dst" \
        busybox sh -c 'cd /src && tar cf - . | tar xf - -C /dst' >/dev/null || return 1
    mg_normalize_fm_local_volume_owner "$target" || return 1
}

mg_normalize_fm_local_volume_owner() {
    local volume="$1"
    local uid="${FM_RUNTIME_UID:-1000}"
    local gid="${FM_RUNTIME_GID:-1000}"

    docker run --rm \
        -v "$volume:/dst" \
        busybox sh -c "chown -R ${uid}:${gid} /dst" >/dev/null || return 1
}

mg_find_legacy_fm_volume() {
    local suffix="$1" target="$2"
    local candidate
    for candidate in \
        "fleet-manager_${suffix}" \
        "fleet_${suffix}" \
        "${suffix}"; do
        [ "$candidate" != "$target" ] || continue
        mg_volume_exists "$candidate" || continue
        mg_volume_has_entries "$candidate" || continue
        printf '%s\n' "$candidate"
        return 0
    done
    return 1
}

mg_volume_exists() {
    docker volume inspect "$1" >/dev/null 2>&1
}

mg_volume_has_entries() {
    mg_volume_exists "$1" || return 1
    docker run --rm -v "$1:/v:ro" busybox sh -c \
        'set -- /v/* /v/.[!.]* /v/..?*; [ -e "$1" ]' >/dev/null 2>&1
}

# fleet-db is a shared multi-tenant cluster; zitadel-db is single-database.
mg_step_pg_major() {
    local service="$1" target_tag="$2"
    local db_name db_user
    case "$service" in
        fleet-db)
            db_name="${POSTGRES_DB:-fleet}"
            db_user="${POSTGRES_USER:-postgres}"
            ;;
        zitadel-db)
            db_name="${ZITADEL_POSTGRES_DB:-zitadel}"
            db_user="${ZITADEL_POSTGRES_USER:-postgres}"
            ;;
        *) log_error "Unknown DB service: $service"; return 1 ;;
    esac

    mg_stop_db_dependents "$service" || return 1
    mg_prepare_db_for_pg_hop "$service" "$target_tag" "$db_name" "$db_user" || return 1

    if [ "$service" = "fleet-db" ]; then
        mg_step_pg_major_all_databases "$service" "$target_tag" "$db_user"
    else
        mg_step_pg_major_single_database "$service" "$target_tag" "$db_name" "$db_user"
    fi
}

mg_step_pg_major_single_database() {
    local service="$1" target_tag="$2" db_name="$3" db_user="$4"
    local snapshot
    snapshot="$(mg_create_pg_hop_snapshot "$service" "$target_tag" "$db_name" "$db_user")" || {
        log_error "Pre-PG-hop dump of $service failed."
        return 1
    }
    log_info "  ✓ fresh dump → $snapshot"
    mg_reinit_db_at_tag "$service" "$target_tag" || return 1
    mg_restore_db_snapshot "$service" "$db_name" "$db_user" "$snapshot"
}

# Preserve every tenant database and the global roles across the volume reset.
mg_step_pg_major_all_databases() {
    local service="$1" target_tag="$2" db_user="$3"
    local snapshot_dir
    snapshot_dir="$(mg_dump_all_databases "$service" "$db_user" "migrate-${service}-pg-hop")" || {
        log_error "Pre-PG-hop dump of $service failed."
        return 1
    }

    local restore_tag
    restore_tag="$(mg_timescale_restore_tag_for_running_fleet "$target_tag")" || return 1
    if [ "$restore_tag" != "$target_tag" ]; then
        log_info "  Timescale bridge: restore on $restore_tag, then upgrade image to $target_tag"
    fi

    mg_reinit_db_at_tag "$service" "$restore_tag" || return 1
    mg_restore_all_databases "$service" "$db_user" "$snapshot_dir" || return 1

    [ "$restore_tag" = "$target_tag" ] && return 0
    mg_swap_db_image "$service" "$target_tag" || return 1
    mg_update_timescale_extension_all "$service" "$db_user"
}

mg_reinit_db_at_tag() {
    local service="$1" tag="$2"
    mg_reset_db_service "$service" || return 1
    mg_start_db_at_tag "$service" "$tag" || return 1
    mg_wait_db_healthy "$service"
}

# Change image tag without dropping the data volume.
mg_swap_db_image() {
    local service="$1" tag="$2"
    mg_compose stop "$service" >/dev/null 2>&1 || true
    mg_start_db_at_tag "$service" "$tag" || return 1
    mg_wait_db_healthy "$service"
}

# User databases only — no templates, no bootstrap 'postgres'.
mg_list_user_databases() {
    local service="$1" db_user="${2:-postgres}"
    local container
    container="$(hc_container_name "$service" 2>/dev/null || true)"
    [ -n "$container" ] || return 1
    docker exec "$container" psql -U "$db_user" -d postgres -AtX -v ON_ERROR_STOP=1 \
        -c "SELECT datname FROM pg_database WHERE datistemplate = false AND datname <> 'postgres' ORDER BY datname;" \
        2>/dev/null
}

# Arg order matches bk_* (service, db_name, db_user).
mg_database_owner() {
    local service="$1" db_name="$2" db_user="$3"
    local container
    container="$(hc_container_name "$service" 2>/dev/null || true)"
    [ -n "$container" ] || return 1
    docker exec "$container" psql -U "$db_user" -d postgres -AtX -v ON_ERROR_STOP=1 \
        -c "SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$db_name';" \
        2>/dev/null
}

# A real DB to probe cluster facts — a shared cluster may have no 'fleet' DB.
mg_representative_fleet_db() {
    local db_user="${POSTGRES_USER:-postgres}"
    local primary="${POSTGRES_DB:-fleet}"
    local container
    container="$(hc_container_name fleet-db 2>/dev/null || true)"
    if [ -n "$container" ] \
        && docker exec "$container" psql -U "$db_user" -d "$primary" -c '\q' >/dev/null 2>&1; then
        printf '%s' "$primary"
        return 0
    fi
    mg_list_user_databases fleet-db "$db_user" | head -1
}

# Roles+passwords — a fresh init only recreates the bootstrap superuser.
mg_dump_globals() {
    local service="$1" db_user="${2:-postgres}" out="$3"
    local container
    container="$(hc_container_name "$service")" || return 1
    docker exec "$container" pg_dumpall -U "$db_user" --globals-only >"$out" 2>/dev/null || return 1
    [ -s "$out" ]
}

# Tolerate only the bootstrap superuser's "already exists"; fail loud otherwise.
mg_restore_globals() {
    local service="$1" db_user="${2:-postgres}" file="$3"
    [ -s "$file" ] || return 0
    local container err unexpected
    container="$(hc_container_name "$service")" || return 1
    err="$(mktemp "${TMPDIR:-/tmp}/fm-globals-restore.XXXXXX")" || return 1
    docker exec -i "$container" psql -U "$db_user" -d postgres <"$file" >/dev/null 2>"$err"
    unexpected="$(grep -i 'ERROR:' "$err" | grep -iv 'already exists' || true)"
    rm -f "$err"
    if [ -n "$unexpected" ]; then
        log_error "Restoring global roles for $service failed: $unexpected"
        return 1
    fi
}

# Globals + every database into one dir; index rows are <name>\t<owner>\t<path>.
mg_dump_all_databases() {
    local service="$1" db_user="$2" label="$3"
    local dir
    dir="${BACKUP_DIR:-${DEPLOY_DIR:-deploy}/state/backups}/${label}-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$dir" || return 1

    if ! mg_dump_globals "$service" "$db_user" "$dir/globals.sql"; then
        log_error "Failed to dump global roles for $service" >&2
        return 1
    fi

    local -a dbs=()
    local d
    while IFS= read -r d; do [ -n "$d" ] && dbs+=("$d"); done < <(mg_list_user_databases "$service" "$db_user")
    if [ "${#dbs[@]}" -eq 0 ]; then
        log_error "No user databases found in $service — refusing an empty snapshot." >&2
        return 1
    fi

    : >"$dir/databases.txt"
    for d in "${dbs[@]}"; do
        mg_dump_one_database "$service" "$d" "$db_user" "$dir" || return 1
    done
    log_info "  ✓ dumped ${#dbs[@]} database(s) + globals → $dir" >&2
    printf '%s' "$dir"
}

mg_dump_one_database() {
    local service="$1" db_name="$2" db_user="$3" dir="$4"
    local safe owner path
    safe="$(printf '%s' "$db_name" | tr -c 'A-Za-z0-9_' '_')"
    owner="$(mg_database_owner "$service" "$db_name" "$db_user" || true)"
    path="$(BACKUP_DIR="$dir" bk_dump "$service" "$db_name" "$db_user" "db-$safe")" || {
        log_error "Dump of database '$db_name' failed" >&2
        return 1
    }
    printf '%s\t%s\t%s\n' "$db_name" "$owner" "$path" >>"$dir/databases.txt"
}

mg_restore_all_databases() {
    local service="$1" db_user="$2" dir="$3"
    [ -d "$dir" ] || { log_error "Snapshot dir missing: $dir"; return 1; }
    [ -f "$dir/databases.txt" ] || { log_error "Snapshot index missing: $dir/databases.txt"; return 1; }

    mg_restore_globals "$service" "$db_user" "$dir/globals.sql" || return 1

    local name owner path
    while IFS=$'\t' read -r name owner path; do
        [ -n "$name" ] || continue
        mg_restore_one_database "$service" "$name" "$db_user" "$owner" "$path" || return 1
    done <"$dir/databases.txt"
}

mg_restore_one_database() {
    local service="$1" db_name="$2" db_user="$3" owner="$4" path="$5"
    [ -s "$path" ] || { log_error "Missing dump for '$db_name': $path"; return 1; }
    BK_ALLOW_DROP_DB=1 BK_RESTORE_PRESERVE_OWNERS=1 \
        bk_restore "$service" "$db_name" "$db_user" "$path" || {
            log_error "Restore of database '$db_name' failed"
            return 1
        }
    mg_set_database_owner "$service" "$db_name" "$db_user" "$owner"
    log_info "  ✓ restored database '$db_name'" >&2
}

# A single-DB bk_dump doesn't carry DB ownership, so reassign it after restore.
mg_set_database_owner() {
    local service="$1" db_name="$2" db_user="$3" owner="$4"
    [ -n "$owner" ] || return 0
    [ "$owner" != "$db_user" ] || return 0
    local container
    container="$(hc_container_name "$service")" || return 1
    docker exec "$container" psql -U "$db_user" -d postgres -v ON_ERROR_STOP=1 \
        -c "ALTER DATABASE \"$db_name\" OWNER TO \"$owner\";" >/dev/null 2>&1 || \
        log_warn "Could not set owner of '$db_name' to '$owner'"
}

# The extension lives per-database — update it in every one.
mg_update_timescale_extension_all() {
    local service="$1" db_user="$2"
    local d rc=0
    while IFS= read -r d; do
        [ -n "$d" ] || continue
        compat_update_timescale_extension \
            "$(hc_container_name "$service")" "$db_user" "$d" "${TIMESCALEDB_VERSION:-}" || {
                log_warn "Timescale extension update failed for '$d'"
                rc=1
            }
    done < <(mg_list_user_databases "$service" "$db_user")
    return "$rc"
}

mg_create_pg_hop_snapshot() {
    local service="$1" target_tag="$2" db_name="$3" db_user="$4"
    bk_create_update_backup "$service" "$db_name" "$db_user" "" "" "migrate-${service}-pg-hop"
}

mg_prepare_db_for_pg_hop() {
    local service="$1" target_tag="$2" db_name="$3" db_user="$4"
    local target_major
    target_major="$(compat_postgres_major_from_tag "${target_tag##*:}" 2>/dev/null || true)"
    if [ "$service" = "zitadel-db" ] && [ "${target_major:-0}" -ge 18 ]; then
        mg_zitadel_recreate_pg18_safe_cache_schema "$db_name" "$db_user" || return 1
    fi
}

mg_zitadel_recreate_pg18_safe_cache_schema() {
    local db_name="$1" db_user="$2"
    local container
    container="$(hc_container_name zitadel-db)"

    log_info "  recreating Zitadel cache schema in PG18-safe form before dump"
    docker exec -i "$container" psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DROP SCHEMA IF EXISTS cache CASCADE;
CREATE SCHEMA cache;

CREATE TABLE cache.objects (
    cache_name varchar NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL,
    PRIMARY KEY(cache_name, id)
) PARTITION BY LIST (cache_name);

CREATE TABLE cache.objects_default
    PARTITION OF cache.objects DEFAULT;

CREATE TABLE cache.string_keys (
    cache_name varchar NOT NULL CHECK (cache_name <> ''),
    index_id integer NOT NULL CHECK (index_id > 0),
    index_key varchar NOT NULL CHECK (index_key <> ''),
    object_id uuid NOT NULL,
    PRIMARY KEY (cache_name, index_id, index_key),
    CONSTRAINT fk_object
        FOREIGN KEY(cache_name, object_id)
        REFERENCES cache.objects(cache_name, id)
        ON DELETE CASCADE
) PARTITION BY LIST (cache_name);

CREATE INDEX string_keys_object_id_idx
    ON cache.string_keys (cache_name, object_id);

CREATE TABLE cache.string_keys_default
    PARTITION OF cache.string_keys DEFAULT;

ALTER SCHEMA cache OWNER TO zitadel;
ALTER TABLE cache.objects OWNER TO zitadel;
ALTER TABLE cache.objects_default OWNER TO zitadel;
ALTER TABLE cache.string_keys OWNER TO zitadel;
ALTER TABLE cache.string_keys_default OWNER TO zitadel;
SQL
    mg_zitadel_verify_cache_parents_logged "$db_name" "$db_user"
}

mg_zitadel_verify_cache_parents_logged() {
    local db_name="$1" db_user="$2"
    local container bad_count
    container="$(hc_container_name zitadel-db)"
    bad_count="$(docker exec -i "$container" psql -U "$db_user" -d "$db_name" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT COUNT(*)
FROM pg_class
WHERE oid IN (to_regclass('cache.objects'), to_regclass('cache.string_keys'))
  AND relpersistence = 'u';
SQL
)"
    if [ "${bad_count:-0}" = "0" ]; then
        return 0
    fi
    log_error "Zitadel cache parent tables are still UNLOGGED after compatibility step."
    return 1
}

mg_stop_db_dependents() {
    local service="$1"
    case "$service" in
        fleet-db)
            mg_compose stop fleet-manager >/dev/null 2>&1 || true
            ;;
        zitadel-db)
            mg_remove_stale_zitadel_api_container || return 1
            compat_remove_legacy_zitadel_container "$COMPOSE_PROJECT_NAME" || return 1
            ;;
    esac
}

mg_reset_db_service() {
    local service="$1"
    local name volume seen
    local -a mounts=() to_remove=()
    name="$(compat_service_container_name "$COMPOSE_PROJECT_NAME" "$service" 2>/dev/null || true)"
    if [ -n "$name" ]; then
        # Capture the real data volume(s) before the container is gone, so the
        # reset removes exactly what this deployment used — never a same-named
        # volume that belongs to an unrelated deployment on the same host.
        mapfile -t mounts < <(
            docker inspect -f \
                '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' \
                "$name" 2>/dev/null || true
        )
        docker rm -f "$name" >/dev/null 2>&1 || return 1
    else
        mg_compose stop "$service" >/dev/null 2>&1 || true
        mg_compose rm -f "$service" >/dev/null 2>&1 || true
    fi
    # Remove the volumes the container actually mounted, plus the canonical
    # project-prefixed name (covers the no-container fallback). Legacy global
    # aliases are only removed when the container truly mounted them.
    to_remove=("${mounts[@]}")
    case "$service" in
        fleet-db) to_remove+=("${COMPOSE_PROJECT_NAME}_fleet-db-data") ;;
        zitadel-db) to_remove+=("${COMPOSE_PROJECT_NAME}_zitadel-db-data") ;;
    esac
    seen=" "
    for volume in "${to_remove[@]}"; do
        [ -n "$volume" ] || continue
        case "$seen" in *" $volume "*) continue ;; esac
        seen="$seen$volume "
        docker volume rm -f "$volume" >/dev/null 2>&1 || true
    done
}

mg_timescale_restore_tag_for_running_fleet() {
    local target_tag="$1"
    local bridge_tag
    bridge_tag="$(mg_timescale_bridge_tag_for_running_fleet "$target_tag" || true)"
    if [ -z "$bridge_tag" ]; then
        printf '%s\n' "$target_tag"
        return 0
    fi
    mg_image_available "$bridge_tag" || {
        log_error "Missing Timescale bridge image: $bridge_tag"
        return 1
    }
    printf '%s\n' "$bridge_tag"
}

mg_timescale_bridge_tag_for_running_fleet() {
    local target_tag="$1"
    local container source_ts target_ts target_major
    container="$(hc_container_name fleet-db 2>/dev/null || true)"
    [ -n "$container" ] || return 1
    local probe_db
    probe_db="$(mg_representative_fleet_db)"
    [ -n "$probe_db" ] || return 1
    source_ts="$(compat_timescale_extension_version "$container" "${POSTGRES_USER:-postgres}" "$probe_db" || true)"
    target_ts="$(compat_timescale_version_from_tag "${target_tag#timescale/timescaledb:}" 2>/dev/null || true)"
    target_major="$(compat_postgres_major_from_tag "${target_tag#timescale/timescaledb:}" 2>/dev/null || true)"
    [ -n "$source_ts" ] && [ -n "$target_ts" ] && [ -n "$target_major" ] || return 1
    [ "$source_ts" != "$target_ts" ] || return 1
    printf 'timescale/timescaledb:%s-pg%s\n' "$source_ts" "$target_major"
}

# Bring a DB service up at an arbitrary tag by overriding the matching env var
# for this single `up -d` call.
mg_start_db_at_tag() {
    local service="$1" target_tag="$2"
    case "$service" in
        fleet-db)
            TIMESCALEDB_VERSION="${target_tag#timescale/timescaledb:}" \
                mg_compose \
                    up -d "$service" >/dev/null
            ;;
        zitadel-db)
            ZITADEL_POSTGRES_VERSION="${target_tag#postgres:}" \
                mg_compose \
                    up -d "$service" >/dev/null
            ;;
        *) return 1 ;;
    esac
}

# Same-major Timescale drift — update the extension across the whole cluster.
mg_step_ts_extension() {
    mg_update_timescale_extension_all "$1" "${POSTGRES_USER:-postgres}"
}

# Same-major image bump — warn on major drift, pull, restart with new tag.
mg_step_image_in_place() {
    local service="$1" target_tag="$2"
    if ! mg_compose_has_service "$service"; then
        log_warn "Skipping image update for $service: service is not present in selected compose files"
        return 0
    fi
    compat_warn_image_major_jump "$COMPOSE_PROJECT_NAME" "$service" "${target_tag##*:}" "$service" || true
    mg_compose pull "$service" >/dev/null 2>&1 || true
    mg_compose up -d --no-deps "$service" >/dev/null || return 1
}

# Intermediate hop in a multi-major Zitadel migration. The PG image to pair
# with this stage travels in the note as `pg=<tag>`. We override both env
# vars for the duration of the stage so compose pulls the right pair, then
# run Zitadel's own bootstrap (its setup phase applies schema migrations).
mg_step_zitadel_stage() {
    local target_tag="$1" note="$2"
    local pg_tag
    pg_tag="$(printf '%s' "$note" | sed -n 's/.*pg=\([^;]*\).*/\1/p')"
    [ -n "$pg_tag" ] || { log_error "zitadel_stage missing pg= directive in note"; return 1; }

    log_info "  staging Zitadel at $target_tag with $pg_tag"
    compat_remove_legacy_zitadel_container "$COMPOSE_PROJECT_NAME" || return 1
    mg_remove_stale_zitadel_api_container || return 1
    ZITADEL_VERSION="$target_tag" \
    ZITADEL_START_PHASE="start-from-setup --init-projections=true" \
    ZITADEL_POSTGRES_VERSION="${pg_tag#postgres:}" \
        mg_compose \
            pull zitadel-api >/dev/null 2>&1 || true
    ZITADEL_VERSION="$target_tag" \
    ZITADEL_START_PHASE="start-from-setup --init-projections=true" \
    ZITADEL_POSTGRES_VERSION="${pg_tag#postgres:}" \
        mg_compose \
            up -d --no-deps zitadel-api >/dev/null || return 1
    mg_zitadel_wait_healthy 300 || return 1
}

mg_remove_stale_zitadel_api_container() {
    local name id
    for name in \
        "${COMPOSE_PROJECT_NAME:-fm}-zitadel-api-1" \
        "${COMPOSE_PROJECT_NAME:-fm}_zitadel-api_1" \
        "fm-zitadel-api-1" \
        "fm_zitadel-api_1"; do
        id="$(docker ps -aq --filter "name=^${name}$" 2>/dev/null | head -1 || true)"
        [ -n "$id" ] || continue
        docker rm -f "$id" >/dev/null || return 1
    done
}

# Final Zitadel hop — image already updated by image_in_place earlier in the
# plan; here we just re-run bootstrap to trigger its setup phase.
mg_step_zitadel_setup() {
    local note="${1:-}"
    mg_ensure_zitadel_runtime_dependencies || return 1
    ZITADEL_START_PHASE="start-from-setup --init-projections=true" \
        mg_step_image_in_place zitadel-api "ghcr.io/zitadel/zitadel:${ZITADEL_VERSION:-}" || return 1
    mg_zitadel_wait_runtime_ready 180 || return 1
    ZITADEL_START_PHASE=start \
        mg_step_image_in_place zitadel-api "ghcr.io/zitadel/zitadel:${ZITADEL_VERSION:-}" || return 1
    mg_zitadel_wait_and_setup 180 || return 1
    if printf '%s' "$note" | grep -q 'before PG major hop'; then
        log_info "  skipping Zitadel Login UI until final PG major hop completes"
        return 0
    fi
    mg_start_zitadel_login_if_present || return 1
}

mg_ensure_zitadel_runtime_dependencies() {
    mg_compose_has_service redis || return 0
    log_info "  ensuring Redis is running for Zitadel runtime cache..."
    mg_compose up -d redis >/dev/null || return 1
    bash "$DEPLOY_DIR/scripts/common/reload-redis-acl.sh" || return 1
}

mg_start_zitadel_login_if_present() {
    mg_compose_has_service zitadel-login || return 0
    log_info "  starting Zitadel Login UI..."
    mg_compose pull zitadel-login >/dev/null 2>&1 || true
    mg_compose up -d zitadel-login >/dev/null || return 1
    hc_wait_or_dump zitadel-login 180
}

mg_compose_has_service() {
    local service="$1"
    mg_compose config --services 2>/dev/null |
        awk -v service="$service" '$0 == service { found = 1 } END { exit found ? 0 : 1 }'
}

# Shared "wait for Zitadel + run bootstrap" used by both stage and final hops.
mg_zitadel_wait_and_setup() {
    local timeout="$1"
    local zitadel_api_host_port="${ZITADEL_API_HOST_PORT:-8080}"
    local host_header="${ZITADEL_HOST_HEADER:-}"
    local machinekey_path="$DEPLOY_DIR/state/machinekey/zitadel-admin-sa.json"
    if [ -z "$host_header" ] && declare -F zitadel_host_header >/dev/null 2>&1; then
        host_header="$(zitadel_host_header)"
    fi
    # shellcheck source=/dev/null
    source "$DEPLOY_DIR/scripts/common/zitadel-lib.sh"
    mg_zitadel_wait_runtime_ready "$timeout" "$zitadel_api_host_port" "$host_header" || return 1
    if [ -f "$machinekey_path" ]; then
        mg_zitadel_wait_machinekey_token_ready \
            "http://localhost:${zitadel_api_host_port}" \
            "$host_header" \
            "$machinekey_path" \
            "${ZITADEL_MACHINEKEY_TOKEN_TIMEOUT:-120}" || return 1
    else
        log_error "Machinekey file is missing: $machinekey_path"
        return 1
    fi
    ZITADEL_URL="http://localhost:${zitadel_api_host_port}" \
    ZITADEL_HOST_HEADER="$host_header" \
    MACHINEKEY_PATH="$machinekey_path" \
    STATE_FILE="$DEPLOY_DIR/state/zitadel.env" \
    SYSTEM_API_KEY_PATH="$DEPLOY_DIR/state/system-api/system-user.pem" \
    DEPLOY_ENV_NAME="$ENV_NAME" \
        bash "$DEPLOY_DIR/scripts/common/bootstrap-zitadel.sh"
}

mg_zitadel_wait_runtime_ready() {
    local timeout="$1"
    local zitadel_api_host_port="${2:-${ZITADEL_API_HOST_PORT:-8080}}"
    local host_header="${3:-${ZITADEL_HOST_HEADER:-}}"
    if [ -z "$host_header" ] && declare -F zitadel_host_header >/dev/null 2>&1; then
        host_header="$(zitadel_host_header)"
    fi
    # shellcheck source=/dev/null
    source "$DEPLOY_DIR/scripts/common/zitadel-lib.sh"
    zitadel_wait_healthy "http://localhost:${zitadel_api_host_port}" "$timeout" || return 1
    zitadel_wait_token_ready \
        "http://localhost:${zitadel_api_host_port}" \
        "$host_header" \
        "${ZITADEL_TOKEN_TIMEOUT:-60}" || return 1
    zitadel_wait_management_ready \
        "http://localhost:${zitadel_api_host_port}" \
        "$host_header" \
        "${ZITADEL_MGMT_API_TIMEOUT:-60}" || return 1
}

mg_zitadel_wait_machinekey_token_ready() {
    local url="$1"
    local host_header="$2"
    local machinekey_path="$3"
    local timeout="${4:-120}"
    local elapsed=0

    echo "Waiting for Zitadel machinekey token readiness..."
    while [ "$elapsed" -lt "$timeout" ]; do
        if ZITADEL_HOST_HEADER="$host_header" zitadel_get_token "$machinekey_path" "$url" >/dev/null 2>&1; then
            echo "Machinekey token ready (${elapsed}s)"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        if [ $((elapsed % 10)) -eq 0 ]; then
            echo "  Machinekey token not ready yet... (${elapsed}s / ${timeout}s)"
        fi
    done

    echo "ERROR: Machinekey token did not become ready within ${timeout}s" >&2
    return 1
}

mg_zitadel_wait_healthy() {
    local timeout="$1"
    local zitadel_api_host_port="${ZITADEL_API_HOST_PORT:-8080}"
    # shellcheck source=/dev/null
    source "$DEPLOY_DIR/scripts/common/zitadel-lib.sh"
    zitadel_wait_healthy "http://localhost:${zitadel_api_host_port}" "$timeout"
}

# Per-tenant container recreate (SaaS multi-tenant). Runs the client's own
# compose stack so the new image tag (from the bumped infra env) takes effect
# inside the tenant project. `--no-deps` keeps the rest of the tenant stack
# undisturbed; we touch only the named service.
mg_step_tenant_recreate() {
    local service="$1" note="$2"
    local cid
    cid="$(printf '%s' "$note" | sed -n 's/.*tenant=\([^;]*\).*/\1/p')"
    [ -n "$cid" ] || { log_error "tenant_recreate missing tenant= directive"; return 1; }
    if ! declare -F run_client_compose >/dev/null 2>&1; then
        log_error "tenant_recreate requires the private migrate adapter to load client compose helpers"
        return 1
    fi
    run_client_compose "$cid" pull "$service" >/dev/null 2>&1 || true
    run_client_compose "$cid" up -d --no-deps --force-recreate "$service" >/dev/null || return 1
}

# FM rebuild — picks up image + source changes and runs DB migrations on boot.
mg_step_fm_rebuild() {
    mg_prepare_fleet_db_for_app_boot || return 1
    mg_generate_fm_runtime_config || return 1
    mg_compose_fm build --no-cache fleet-manager >/dev/null || return 1
    mg_compose_fm up -d --no-deps fleet-manager >/dev/null || return 1
}

# Wait for the DB service to be marked healthy by compose (60s).
mg_wait_db_healthy() {
    local service="$1" tries=0
    while [ "$tries" -lt 30 ]; do
        if mg_compose ps "$service" 2>/dev/null | grep -q "(healthy)"; then
            return 0
        fi
        tries=$((tries + 1))
        sleep 2
    done
    log_error "$service did not become healthy in 60s."
    return 1
}

# FM health probe — same check the smoke tests use.
mg_health_gate() {
    if ! compat_service_container_id "$COMPOSE_PROJECT_NAME" fleet-manager >/dev/null 2>&1; then
        log_warn "Fleet Manager service is not deployed — skipping FM health gate."
        return 0
    fi
    local url="${FM_HEALTH_URL:-$(compute_fm_url)/health}"
    local tries=0
    while [ "$tries" -lt 30 ]; do
        if curl -sf \
            --connect-timeout "${MIGRATE_HEALTH_CONNECT_TIMEOUT_SECONDS:-2}" \
            --max-time "${MIGRATE_HEALTH_MAX_TIME_SECONDS:-5}" \
            "$url" >/dev/null 2>&1; then
            return 0
        fi
        tries=$((tries + 1))
        sleep 2
    done
    return 1
}

# Restore snapshots when the post-migration health gate fails.
mg_rollback() {
    local fleet_snapshot="$1" zitadel_snapshot="$2"
    local fleet_db="${POSTGRES_DB:-fleet}"
    local fleet_user="${POSTGRES_USER:-postgres}"
    local zitadel_db="${ZITADEL_POSTGRES_DB:-zitadel}"
    local zitadel_user="${ZITADEL_POSTGRES_USER:-postgres}"
    local rollback_failed=0
    log_warn "Rolling back to pre-migration snapshots..."
    mg_compose stop fleet-manager >/dev/null 2>&1 || true
    mg_compose stop zitadel-login >/dev/null 2>&1 || true
    mg_compose stop zitadel-api >/dev/null 2>&1 || true
    # An `A && B || true` one-liner would swallow a failed restore (the `|| true`
    # fires on B's non-zero too). Check each restore explicitly and fail loud so
    # the operator knows the DB was NOT returned to its known-good state.
    if [ -n "$fleet_snapshot" ]; then
        if ! mg_restore_snapshot_on_original_db fleet-db "$fleet_db" "$fleet_user" "$fleet_snapshot" "${MG_ROLLBACK_FLEET_DB_TAG:-}"; then
            log_error "ROLLBACK FAILED: fleet-db was NOT restored to its pre-migration snapshot — the database may be in a broken/half-restored state. Manual recovery required."
            rollback_failed=1
        fi
    fi
    if [ -n "$zitadel_snapshot" ]; then
        if ! mg_restore_snapshot_on_original_db zitadel-db "$zitadel_db" "$zitadel_user" "$zitadel_snapshot" "${MG_ROLLBACK_ZITADEL_DB_TAG:-}"; then
            log_error "ROLLBACK FAILED: zitadel-db was NOT restored to its pre-migration snapshot — manual recovery required."
            rollback_failed=1
        fi
    fi
    return "$rollback_failed"
}

mg_restore_snapshot_on_original_db() {
    local service="$1" db_name="$2" db_user="$3" snapshot="$4" original_tag="$5"
    if [ -n "$original_tag" ]; then
        log_warn "  restoring $service on original image tag $original_tag"
        mg_reinit_db_at_tag "$service" "$original_tag" || return 1
    fi
    mg_restore_db_snapshot "$service" "$db_name" "$db_user" "$snapshot"
}

mg_restore_db_snapshot() {
    local service="$1" db_name="$2" db_user="$3" snapshot="$4"
    # A directory snapshot is the multi-tenant form (globals + every database).
    if [ -d "$snapshot" ]; then
        mg_restore_all_databases "$service" "$db_user" "$snapshot"
        return $?
    fi
    if [ "$service" = "zitadel-db" ]; then
        BK_RESTORE_PRESERVE_OWNERS=1 bk_restore "$service" "$db_name" "$db_user" "$snapshot" || return 1
        mg_zitadel_ensure_database_owner "$db_name" "$db_user"
        return $?
    fi
    bk_restore "$service" "$db_name" "$db_user" "$snapshot"
}

mg_zitadel_ensure_database_owner() {
    local db_name="$1" db_admin_user="$2"
    local app_user="${ZITADEL_DATABASE_POSTGRES_USER_USERNAME:-zitadel}"
    local container
    container="$(hc_container_name zitadel-db)"
    docker exec -i "$container" psql -U "$db_admin_user" -d "$db_name" \
        -v ON_ERROR_STOP=1 \
        -v db_name="$db_name" \
        -v app_user="$app_user" <<'SQL' >/dev/null
ALTER DATABASE :"db_name" OWNER TO :"app_user";
GRANT CONNECT, CREATE ON DATABASE :"db_name" TO :"app_user";
GRANT ALL PRIVILEGES ON DATABASE :"db_name" TO :"app_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
SQL
}
