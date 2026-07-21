#!/usr/bin/env bash
# Synthetic environmental sensors + 15-minute history and events. Dev DB only.
# Idempotent — marker jdoc.source = 'demo-seed-environment'. One device per
# family so every capability tab lights up. Neo water is intentionally excluded.
# SQL lives in seed/environment-data.sql (single source; also runnable by hand).

set -euo pipefail

seed_environment_data() {
    local db_container="${1:-${COMPOSE_PROJECT_NAME:-fm}-fleet-db-1}"
    local db_user="${POSTGRES_USER:-postgres}"
    local db_name="${POSTGRES_DB:-fleet}"
    local sql_file="${BASH_SOURCE[0]%/*}/seed/environment-data.sql"

    if ! docker ps --filter "name=^${db_container}$" --format '{{.Names}}' | grep -qx "$db_container"; then
        info "[env-seed] DB container ${db_container} not running — skipping."
        return 0
    fi
    if [ ! -f "$sql_file" ]; then
        info "[env-seed] SQL not found at ${sql_file} — skipping."
        return 0
    fi

    info "[env-seed] Seeding environmental sensors + history + events..."
    if ! docker exec -i "$db_container" psql -U "$db_user" -d "$db_name" \
        -v ON_ERROR_STOP=1 <"$sql_file" >/dev/null; then
        return 1
    fi
    ok "[env-seed] Environmental sensors + telemetry seeded."
}
