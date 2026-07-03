# shellcheck shell=bash
# Upgrade audit helpers: data snapshots, post-update comparison, and
# Zitadel/Postgres major-version planning. This is intentionally bash-native so
# deploy.sh remains the single orchestrator for self-hosted installs.

UPGRADE_AUDIT_DIR="${UPGRADE_AUDIT_DIR:-${STATE_DIR:-deploy/state}/upgrade-audits}"
UPGRADE_AUDIT_EXACT_TIMESERIES="${UPGRADE_AUDIT_EXACT_TIMESERIES:-0}"

ua_now() {
    date -u +%Y%m%dT%H%M%SZ
}

ua_iso_now() {
    date -u +%Y-%m-%dT%H:%M:%SZ
}

ua_container_name() {
    local service="$1"
    hc_container_name "$service"
}

ua_psql() {
    local service="$1"
    local db_name="$2"
    local db_user="$3"
    local sql="$4"
    local container
    container="$(ua_container_name "$service")"
    docker exec "$container" psql -U "$db_user" -d "$db_name" -AtX -v ON_ERROR_STOP=1 -c "$sql"
}

ua_sql_quote_ident() {
    local value="$1"
    printf '"%s"' "${value//\"/\"\"}"
}

ua_split_table_ref() {
    local table_ref="$1"
    case "$table_ref" in
        *.*) return 0 ;;
        *) return 1 ;;
    esac
}

ua_table_exists() {
    local service="$1" db_name="$2" db_user="$3" table_ref="$4"
    [ "$(ua_psql "$service" "$db_name" "$db_user" "SELECT to_regclass('$table_ref') IS NOT NULL;" 2>/dev/null || true)" = "t" ]
}

ua_column_exists() {
    local service="$1" db_name="$2" db_user="$3" table_ref="$4" column="$5"
    ua_split_table_ref "$table_ref" || return 1
    local schema="${table_ref%%.*}"
    local table="${table_ref#*.}"
    [ "$(ua_psql "$service" "$db_name" "$db_user" \
        "SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = '$schema'
              AND table_name = '$table'
              AND column_name = '$column'
        );" 2>/dev/null || true)" = "t" ]
}

ua_exact_count() {
    local service="$1" db_name="$2" db_user="$3" table_ref="$4"
    ua_split_table_ref "$table_ref" || return 1
    local schema="${table_ref%%.*}"
    local table="${table_ref#*.}"
    local qs qt
    qs="$(ua_sql_quote_ident "$schema")"
    qt="$(ua_sql_quote_ident "$table")"
    ua_psql "$service" "$db_name" "$db_user" "SELECT COUNT(*) FROM $qs.$qt;"
}

ua_query_count() {
    local service="$1" db_name="$2" db_user="$3" sql="$4"
    ua_psql "$service" "$db_name" "$db_user" "$sql"
}

ua_schema_counts_json() {
    local service="$1" db_name="$2" db_user="$3"
    ua_psql "$service" "$db_name" "$db_user" "
        SELECT COALESCE(jsonb_object_agg(table_schema, table_count ORDER BY table_schema), '{}'::jsonb)
        FROM (
            SELECT table_schema, COUNT(*) AS table_count
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            GROUP BY table_schema
        ) s;
    "
}

ua_table_estimates_json() {
    local service="$1" db_name="$2" db_user="$3"
    ua_psql "$service" "$db_name" "$db_user" "
        SELECT COALESCE(jsonb_object_agg(schemaname || '.' || relname, n_live_tup ORDER BY schemaname, relname), '{}'::jsonb)
        FROM pg_stat_user_tables
        WHERE schemaname !~ '^_'
          AND schemaname NOT IN ('timescaledb_information', 'timescaledb_experimental');
    "
}

ua_fleet_critical_tables() {
    cat <<'EOF'
device.list
device.virtual_device
device.virtual_device_binding
device.virtual_device_profile
device.blu_device
device.blu_transport
device_em.lifetime_counters
fm.energy_classification
fm.energy_classification_audit
fm.energy_preset
fm.energy_preset_classification
device_group.list
device_group.item
device_group.organization
organization.profile
organization.list
organization.groups
organization.group_members
organization.tags
organization.tag_assignments
organization.locations
organization.location_assignments
organization.personas
organization.user_groups
organization.user_group_memberships
organization.fm_scoped_pats
organization.certificates
organization.device_credentials
ui.dashboard
ui.dashboard_item
ui.dashboard_settings
ui.dashboard_pin
notifications.alert_rules
notifications.alert_instances
notifications.channels
notifications.channel_secrets
notifications.routing_policies
notifications.on_call_schedules
notifications.user_notification_preferences
notifications.inbox_items
notifications.delivery_jobs
notifications.delivery_attempts
notifications.email_templates
logging.report_configs
logging.report_instances
logging.audit_log
user.list
EOF
    if [ "$UPGRADE_AUDIT_EXACT_TIMESERIES" = "1" ]; then
        cat <<'EOF'
device.status
device_em.stats
device_em.sync
EOF
    fi
}

ua_exact_counts_json() {
    local service="$1" db_name="$2" db_user="$3"
    local json="{}" table_ref count
    while IFS= read -r table_ref; do
        [ -n "$table_ref" ] || continue
        if ua_table_exists "$service" "$db_name" "$db_user" "$table_ref"; then
            count="$(ua_exact_count "$service" "$db_name" "$db_user" "$table_ref")" || return 1
            json="$(jq -cn --argjson base "$json" --arg key "$table_ref" --argjson value "$count" '$base + {($key): $value}')"
        fi
    done < <(ua_fleet_critical_tables)
    printf '%s\n' "$json"
}

ua_fleet_domain_issues_json() {
    local service="$1" db_name="$2" db_user="$3"
    local issues="{}"
    local count

    ua_add_issue() {
        local key="$1" value="$2"
        issues="$(jq -cn --argjson base "$issues" --arg key "$key" --argjson value "$value" '$base + {($key): $value}')"
    }

    if ua_table_exists "$service" "$db_name" "$db_user" "device.list" \
        && ua_column_exists "$service" "$db_name" "$db_user" "device.list" "organization_id"; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "SELECT COUNT(*) FROM device.list WHERE organization_id IS NULL;")" || return 1
        ua_add_issue "device_without_org" "$count"
    fi

    if ua_table_exists "$service" "$db_name" "$db_user" "device.list" \
        && ua_column_exists "$service" "$db_name" "$db_user" "device.list" "external_id"; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "
            SELECT COUNT(*) FROM (
                SELECT external_id FROM device.list
                WHERE external_id IS NOT NULL
                GROUP BY external_id HAVING COUNT(*) > 1
            ) d;
        ")" || return 1
        ua_add_issue "duplicate_device_external_id" "$count"
    fi

    if ua_table_exists "$service" "$db_name" "$db_user" "ui.dashboard" \
        && ua_column_exists "$service" "$db_name" "$db_user" "ui.dashboard" "organization_id"; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "SELECT COUNT(*) FROM ui.dashboard WHERE organization_id IS NULL;")" || return 1
        ua_add_issue "dashboard_without_org" "$count"
    fi

    if ua_table_exists "$service" "$db_name" "$db_user" "organization.groups" \
        && ua_column_exists "$service" "$db_name" "$db_user" "organization.groups" "organization_id"; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "SELECT COUNT(*) FROM organization.groups WHERE organization_id IS NULL;")" || return 1
        ua_add_issue "group_without_org" "$count"
    fi

    if ua_table_exists "$service" "$db_name" "$db_user" "organization.group_members" \
        && ua_table_exists "$service" "$db_name" "$db_user" "organization.groups"; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "
            SELECT COUNT(*)
            FROM organization.group_members gm
            LEFT JOIN organization.groups g ON g.id = gm.group_id
            WHERE g.id IS NULL;
        ")" || return 1
        ua_add_issue "orphan_group_members" "$count"
    fi

    if ua_table_exists "$service" "$db_name" "$db_user" "device_em.lifetime_counters" \
        && ua_table_exists "$service" "$db_name" "$db_user" "device.list"; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "
            SELECT COUNT(*)
            FROM device_em.lifetime_counters lc
            LEFT JOIN device.list d ON d.id = lc.device
            WHERE d.id IS NULL;
        ")" || return 1
        ua_add_issue "orphan_energy_lifetime_counters" "$count"
    fi

    if ua_table_exists "$service" "$db_name" "$db_user" "fm.energy_classification" \
        && ua_table_exists "$service" "$db_name" "$db_user" "device.list"; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "
            SELECT COUNT(*)
            FROM fm.energy_classification ec
            LEFT JOIN device.list d ON d.id = ec.device
            WHERE d.id IS NULL;
        ")" || return 1
        ua_add_issue "orphan_energy_classifications" "$count"
    fi

    if ua_table_exists "$service" "$db_name" "$db_user" "fm.energy_preset_classification" \
        && ua_table_exists "$service" "$db_name" "$db_user" "fm.energy_preset"; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "
            SELECT COUNT(*)
            FROM fm.energy_preset_classification pc
            LEFT JOIN fm.energy_preset p ON p.preset_id = pc.preset_id
            WHERE p.preset_id IS NULL;
        ")" || return 1
        ua_add_issue "orphan_energy_preset_classifications" "$count"
    fi

    if ua_table_exists "$service" "$db_name" "$db_user" "organization.tags" \
        && ua_column_exists "$service" "$db_name" "$db_user" "organization.tags" "organization_id"; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "SELECT COUNT(*) FROM organization.tags WHERE organization_id IS NULL;")" || return 1
        ua_add_issue "tag_without_org" "$count"
    fi

    if ua_table_exists "$service" "$db_name" "$db_user" "organization.locations" \
        && ua_column_exists "$service" "$db_name" "$db_user" "organization.locations" "organization_id"; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "SELECT COUNT(*) FROM organization.locations WHERE organization_id IS NULL;")" || return 1
        ua_add_issue "location_without_org" "$count"
    fi

    if ua_table_exists "$service" "$db_name" "$db_user" "migration.\"migration.locks\""; then
        count="$(ua_query_count "$service" "$db_name" "$db_user" "SELECT COUNT(*) FROM migration.\"migration.locks\";")" || return 1
        ua_add_issue "migration_lock_rows" "$count"
    fi

    printf '%s\n' "$issues"
}

ua_pg_summary_json() {
    local service="$1" db_name="$2" db_user="$3"
    local server_version timescale_version
    server_version="$(ua_psql "$service" "$db_name" "$db_user" "SELECT current_setting('server_version');")"
    timescale_version="$(ua_psql "$service" "$db_name" "$db_user" "SELECT COALESCE((SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'), '');")"
    jq -cn \
        --arg serverVersion "$server_version" \
        --arg timescaleVersion "$timescale_version" \
        '{serverVersion: $serverVersion, timescaleVersion: $timescaleVersion}'
}

ua_snapshot_fleet() {
    local service="$1" db_name="$2" db_user="$3" label="${4:-manual}" out_path="${5:-}"
    mkdir -p "$UPGRADE_AUDIT_DIR"
    [ -n "$out_path" ] || out_path="$UPGRADE_AUDIT_DIR/fleet-${label}-$(ua_now).json"

    local pg schemas estimates critical issues
    pg="$(ua_pg_summary_json "$service" "$db_name" "$db_user")" || return 1
    schemas="$(ua_schema_counts_json "$service" "$db_name" "$db_user")" || return 1
    estimates="$(ua_table_estimates_json "$service" "$db_name" "$db_user")" || return 1
    critical="$(ua_exact_counts_json "$service" "$db_name" "$db_user")" || return 1
    issues="$(ua_fleet_domain_issues_json "$service" "$db_name" "$db_user")" || return 1

    jq -n \
        --arg schemaVersion "1" \
        --arg kind "fleet-upgrade-audit-snapshot" \
        --arg label "$label" \
        --arg createdAt "$(ua_iso_now)" \
        --arg service "$service" \
        --arg database "$db_name" \
        --argjson postgres "$pg" \
        --argjson schemaCounts "$schemas" \
        --argjson tableEstimates "$estimates" \
        --argjson criticalCounts "$critical" \
        --argjson domainIssues "$issues" \
        '{
            schemaVersion: $schemaVersion,
            kind: $kind,
            label: $label,
            createdAt: $createdAt,
            database: {service: $service, name: $database},
            postgres: $postgres,
            schemaCounts: $schemaCounts,
            tableEstimates: $tableEstimates,
            criticalCounts: $criticalCounts,
            domainIssues: $domainIssues
        }' > "$out_path" || return 1
    chmod 0600 "$out_path"
    printf '%s\n' "$out_path"
}

ua_zitadel_tables() {
    cat <<'EOF'
eventstore.events
eventstore.events2
eventstore.unique_constraints
auth.users
auth.orgs
auth.projects
auth.members
auth.user_sessions
projections.current_states
projections.failed_events
system.instances
EOF
}

ua_zitadel_counts_json() {
    local service="$1" db_name="$2" db_user="$3"
    local json="{}" table_ref count
    while IFS= read -r table_ref; do
        [ -n "$table_ref" ] || continue
        if ua_table_exists "$service" "$db_name" "$db_user" "$table_ref"; then
            count="$(ua_exact_count "$service" "$db_name" "$db_user" "$table_ref")" || return 1
            json="$(jq -cn --argjson base "$json" --arg key "$table_ref" --argjson value "$count" '$base + {($key): $value}')"
        fi
    done < <(ua_zitadel_tables)
    printf '%s\n' "$json"
}

ua_snapshot_zitadel() {
    local service="$1" db_name="$2" db_user="$3" label="${4:-manual}" out_path="${5:-}"
    mkdir -p "$UPGRADE_AUDIT_DIR"
    [ -n "$out_path" ] || out_path="$UPGRADE_AUDIT_DIR/zitadel-${label}-$(ua_now).json"

    local pg schemas estimates critical
    pg="$(ua_pg_summary_json "$service" "$db_name" "$db_user")" || return 1
    schemas="$(ua_schema_counts_json "$service" "$db_name" "$db_user")" || return 1
    estimates="$(ua_table_estimates_json "$service" "$db_name" "$db_user")" || return 1
    critical="$(ua_zitadel_counts_json "$service" "$db_name" "$db_user")" || return 1

    jq -n \
        --arg schemaVersion "1" \
        --arg kind "zitadel-upgrade-audit-snapshot" \
        --arg label "$label" \
        --arg createdAt "$(ua_iso_now)" \
        --arg service "$service" \
        --arg database "$db_name" \
        --argjson postgres "$pg" \
        --argjson schemaCounts "$schemas" \
        --argjson tableEstimates "$estimates" \
        --argjson criticalCounts "$critical" \
        '{
            schemaVersion: $schemaVersion,
            kind: $kind,
            label: $label,
            createdAt: $createdAt,
            database: {service: $service, name: $database},
            postgres: $postgres,
            schemaCounts: $schemaCounts,
            tableEstimates: $tableEstimates,
            criticalCounts: $criticalCounts
        }' > "$out_path" || return 1
    chmod 0600 "$out_path"
    printf '%s\n' "$out_path"
}

ua_compare_snapshots() {
    local before_path="$1" after_path="$2" out_path="${3:-}"
    [ -s "$before_path" ] || return 1
    [ -s "$after_path" ] || return 1
    mkdir -p "$UPGRADE_AUDIT_DIR"
    [ -n "$out_path" ] || out_path="$UPGRADE_AUDIT_DIR/compare-$(ua_now).json"

    jq -n \
        --slurpfile before "$before_path" \
        --slurpfile after "$after_path" \
        --arg beforePath "$before_path" \
        --arg afterPath "$after_path" \
        --arg createdAt "$(ua_iso_now)" '
        def countDrops:
            ($before[0].criticalCounts // {}) as $b
            | ($after[0].criticalCounts // {}) as $a
            | [$b | to_entries[] as $entry
                | select(($a[$entry.key] // -1) < $entry.value)
                | {table: $entry.key, before: $entry.value, after: ($a[$entry.key] // null)}];
        def missingTables:
            (($before[0].tableEstimates // {}) | keys_unsorted) as $bk
            | (($after[0].tableEstimates // {}) | keys_unsorted) as $ak
            | [$bk[] | select(($ak | index(.)) | not)];
        def postDomainFailures:
            ($after[0].domainIssues // {}) as $i
            | ["device_without_org", "duplicate_device_external_id",
               "dashboard_without_org", "group_without_org",
               "orphan_group_members", "orphan_energy_lifetime_counters",
               "orphan_energy_classifications",
               "orphan_energy_preset_classifications",
               "tag_without_org", "location_without_org"] as $fatal
            | [$i | to_entries[] as $entry
                | select(($fatal | index($entry.key)) and ($entry.value | tonumber) > 0)
                | $entry];
        (countDrops) as $drops
        | (missingTables) as $missing
        | (postDomainFailures) as $domainFailures
        | {
            schemaVersion: "1",
            kind: "upgrade-audit-compare",
            createdAt: $createdAt,
            before: $beforePath,
            after: $afterPath,
            result: (if (($drops | length) == 0 and ($domainFailures | length) == 0) then "pass" else "fail" end),
            failures: {
                criticalCountDrops: $drops,
                domainIssues: $domainFailures
            },
            warnings: {
                missingEstimatedTables: $missing,
                migrationLockRows: ($after[0].domainIssues.migration_lock_rows // null)
            }
        }' > "$out_path" || return 1
    chmod 0600 "$out_path"

    jq -e '.result == "pass"' "$out_path" >/dev/null
}

ua_zitadel_major() {
    local version="$1"
    version="${version#v}"
    printf '%s' "$version" | sed -n 's/^\([0-9][0-9]*\).*/\1/p'
}

ua_plan_zitadel_upgrade() {
    local current_version="$1" target_version="$2" current_pg_major="$3" target_pg_major="$4" out_path="${5:-}"
    mkdir -p "$UPGRADE_AUDIT_DIR"
    [ -n "$out_path" ] || out_path="$UPGRADE_AUDIT_DIR/zitadel-plan-$(ua_now).json"

    local current_major target_major safe_direct=false reason required
    current_major="$(ua_zitadel_major "$current_version")"
    target_major="$(ua_zitadel_major "$target_version")"
    required="[]"
    reason="direct upgrade allowed"

    if [ -z "$current_major" ] || [ "$current_version" = "unknown" ]; then
        safe_direct=false
        reason="current Zitadel version could not be detected; inspect the running container or saved manifest before upgrading"
        required='[
            {"stage":"detect-current-zitadel","description":"record the current Zitadel image/tag and database state before choosing an upgrade path"},
            {"stage":"backup-current-db","description":"full Zitadel database backup and verified restore"},
            {"stage":"choose-supported-path","description":"use direct update only after the source major is known"}
        ]'
    elif [ -z "$current_pg_major" ] && [ -n "$target_pg_major" ]; then
        safe_direct=false
        reason="current Zitadel PostgreSQL major could not be detected; inspect the DB container or data directory before upgrading"
        required='[
            {"stage":"detect-current-postgres","description":"record the current PostgreSQL major before changing the configured image"},
            {"stage":"backup-current-db","description":"full Zitadel database backup and verified restore"},
            {"stage":"choose-postgres-upgrade-method","description":"use pg_upgrade or logical dump/restore when majors differ"}
        ]'
    elif [ -n "$current_major" ] && [ -n "$target_major" ] \
        && [ "$current_major" -le 2 ] && [ "$target_major" -ge 4 ]; then
        safe_direct=false
        reason="existing Zitadel v2 data must be staged through v3.4.9 before v4; do not combine this with a PostgreSQL 18 data-dir jump"
        required='[
            {"stage":"backup-v2-pg16","description":"full Zitadel pg_dump/pg_dumpall and verified restore"},
            {"stage":"zitadel-v3.4.9-on-pg17","description":"run Zitadel setup/migrations on PostgreSQL 17-compatible storage"},
            {"stage":"verify-v3","description":"login, OIDC discovery, token introspection, service PAT, project grants"},
            {"stage":"backup-v3-success","description":"backup the successful v3 state"},
            {"stage":"zitadel-v4.14.0","description":"run v4 api+login split with login-client/bootstrap volume"},
            {"stage":"verify-v4","description":"login V2, admin/service users, PATs, grants, SMTP provider, actions"},
            {"stage":"postgres-major-upgrade","description":"only after Zitadel is healthy, move DB major with pg_upgrade or dump/restore"}
        ]'
    elif [ -n "$current_pg_major" ] && [ -n "$target_pg_major" ] \
        && [ "$current_pg_major" != "$target_pg_major" ]; then
        safe_direct=false
        reason="PostgreSQL major versions differ; use pg_upgrade or dump/restore with verified backup"
        required='[
            {"stage":"backup-current-db","description":"full database backup and verified restore"},
            {"stage":"postgres-major-upgrade","description":"pg_upgrade or logical dump/restore"},
            {"stage":"verify-identity-flows","description":"login, discovery, introspection, PATs, grants"}
        ]'
    else
        safe_direct=true
    fi

    jq -n \
        --arg kind "zitadel-upgrade-plan" \
        --arg createdAt "$(ua_iso_now)" \
        --arg currentVersion "$current_version" \
        --arg targetVersion "$target_version" \
        --arg currentPgMajor "$current_pg_major" \
        --arg targetPgMajor "$target_pg_major" \
        --arg reason "$reason" \
        --argjson safeDirect "$safe_direct" \
        --argjson requiredStages "$required" \
        '{
            schemaVersion: "1",
            kind: $kind,
            createdAt: $createdAt,
            current: {zitadelVersion: $currentVersion, postgresMajor: $currentPgMajor},
            target: {zitadelVersion: $targetVersion, postgresMajor: $targetPgMajor},
            safeDirect: $safeDirect,
            reason: $reason,
            requiredStages: $requiredStages
        }' > "$out_path" || return 1
    chmod 0600 "$out_path"
    printf '%s\n' "$out_path"
}
