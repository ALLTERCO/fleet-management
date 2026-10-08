#!/usr/bin/env bash
#
# Per-template generated history, by filename convention.
#
# A template's dashboard can only be developed against ITS OWN estate: Aussie
# Grocers needs its fixture-defined window on every cold-chain probe, not one
# sensor per family.
# The generic generators cannot know that, so each template ships its own SQL
# and this runs whichever ones exist:
#
#   seed/<template-id>-sensor-history.sql
#   seed/<template-id>-alert-history.sql
#
# Adding a template means adding its SQL. No change here, and no list to keep in
# step. A template with no file simply gets nothing extra.
#
# Dev and test only — the caller (_seed_telemetry_history) is already gated to
# those environments, and each SQL file guards itself as well.

seed_template_history() {
    local template_id="${FM_DEV_TEMPLATE_ID:-}"
    local db_container="${1:-${COMPOSE_PROJECT_NAME:-fm}-fleet-db-1}"
    local db_user="${POSTGRES_USER:-postgres}"
    local db_name="${POSTGRES_DB:-fleet}"
    local seed_dir="${BASH_SOURCE[0]%/*}/seed"

    if [ -z "$template_id" ]; then
        return 0
    fi
    if ! docker ps --filter "name=^${db_container}$" --format '{{.Names}}' | grep -qx "$db_container"; then
        info "[template-history] DB container ${db_container} not running — skipping."
        return 0
    fi

    local fixture history_days kind sql_file output
    fixture="${DEPLOY_DIR:-${BASH_SOURCE[0]%/*}/../..}/seed/${template_id}.json"
    history_days=60
    if [ -f "$fixture" ]; then
        history_days=$(jq -r '.simulator.historyDays // 60' "$fixture")
    fi
    [[ "$history_days" =~ ^[1-9][0-9]*$ ]] || {
        error "[template-history] ${template_id}: simulator.historyDays must be a positive integer."
        return 1
    }
    for kind in sensor alert; do
        sql_file="${seed_dir}/${template_id}-${kind}-history.sql"
        [ -f "$sql_file" ] || continue
        info "[template-history] ${template_id}: generating ${kind} history..."
        # Notices carry the row counts the generators report, and they are the
        # only evidence the data landed — so they are shown, not swallowed.
        if ! output=$(docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
            -v ON_ERROR_STOP=1 -v "history_days=$history_days" \
            <"$sql_file" 2>&1); then
            grep -E '^(NOTICE|ERROR)' <<<"$output" || true
            error "[template-history] ${template_id} ${kind} history failed"
            return 1
        fi
        grep -E '^(NOTICE|ERROR)' <<<"$output" || true
    done
    return 0
}
