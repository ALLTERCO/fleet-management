#!/usr/bin/env bash
# Verify the three new scope-related migrations apply UP and roll back DOWN cleanly.
# Reads PG connection from env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE.
# Skips quietly if Postgres is not reachable.
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
    echo "psql not installed — skipping migration-cycle check."
    exit 0
fi

if ! psql -c 'select 1' >/dev/null 2>&1; then
    echo "Postgres not reachable via PG* env — skipping migration-cycle check."
    exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIG_DIR="$REPO_ROOT/backend/db/migration/postgresql"

# The scope-resolution migrations this check exercises.
MIGS_DEVICE="$MIG_DIR/device/6400_fn_resolve_scope.sql $MIG_DIR/device/6401_fn_device_memberships.sql"

apply_section() {
    local file=$1
    local section=$2
    awk -v sec="$section" '
        /^--------------UP$/ { in_up=1; in_down=0; next }
        /^--------------DOWN$/ { in_up=0; in_down=1; next }
        sec=="UP" && in_up { print }
        sec=="DOWN" && in_down { print }
    ' "$file"
}

verify_function_exists() {
    local fname=$1
    local out
    out=$(psql -At -c "select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname || '.' || p.proname = '$fname' limit 1;")
    if [ "$out" != "1" ]; then
        echo "FAIL: function $fname not found after UP"
        exit 1
    fi
    echo "  ✓ $fname exists"
}

verify_function_absent() {
    local fname=$1
    local out
    out=$(psql -At -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname || '.' || p.proname = '$fname';")
    if [ "$out" != "0" ]; then
        echo "FAIL: function $fname still exists after DOWN"
        exit 1
    fi
    echo "  ✓ $fname removed"
}

run_section() {
    local file=$1
    local section=$2
    apply_section "$file" "$section" | psql -v ON_ERROR_STOP=1 >/dev/null
}

echo "Applying UP for new migrations..."
for f in $MIGS_DEVICE; do
    echo "  UP: $(basename "$f")"
    run_section "$f" "UP"
done

echo "Verifying functions exist..."
verify_function_exists 'device.fn_resolve_scope'
verify_function_exists 'device.fn_device_memberships'

echo "Applying DOWN..."
for f in $MIGS_DEVICE; do
    echo "  DOWN: $(basename "$f")"
    run_section "$f" "DOWN"
done

echo "Verifying clean rollback..."
verify_function_absent 'device.fn_resolve_scope'
verify_function_absent 'device.fn_device_memberships'

# Re-apply UP so the DB returns to the new-schema state.
echo "Re-applying UP to restore expected state..."
for f in $MIGS_DEVICE; do
    run_section "$f" "UP"
done

echo "Migration cycle PASS."
