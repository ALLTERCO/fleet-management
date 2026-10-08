#!/usr/bin/env bash
# Reconcile Redis ACL from the host file when Redis is already running.

set -euo pipefail

: "${REDIS_ADMIN_PASSWORD:?REDIS_ADMIN_PASSWORD is required}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
container_name="${REDIS_CONTAINER:-fm-redis}"
aclfile_path="${REDIS_ACLFILE:-${STATE_DIR:-$DEPLOY_DIR/state}/redis-users.acl}"

if [ ! -s "$aclfile_path" ]; then
    echo "ERROR: Redis ACL file is missing or empty: $aclfile_path" >&2
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -Fxq "$container_name"; then
    exit 0
fi

reconcile_acl() {
    local line live_acl user
    local -a parts=()
    while IFS= read -r line || [ -n "$line" ]; do
        [ -n "$line" ] || continue
        read -r -a parts <<< "$line"
        if [ "${parts[0]:-}" != user ] || [ "${#parts[@]}" -lt 3 ]; then
            return 1
        fi
        docker exec "$container_name" redis-cli \
            --user fm-admin --pass "$REDIS_ADMIN_PASSWORD" --no-auth-warning \
            ACL SETUSER "${parts[1]}" reset "${parts[@]:2}" >/dev/null 2>&1 || return 1
    done < "$aclfile_path"

    live_acl="$(
        docker exec "$container_name" redis-cli \
            --user fm-admin --pass "$REDIS_ADMIN_PASSWORD" --no-auth-warning \
            ACL LIST 2>/dev/null
    )" || return 1
    while IFS= read -r user; do
        [ -n "$user" ] || continue
        if ! awk -v u="$user" '$1=="user" && $2==u { found=1 } END { exit !found }' "$aclfile_path"; then
            docker exec "$container_name" redis-cli \
                --user fm-admin --pass "$REDIS_ADMIN_PASSWORD" --no-auth-warning \
                ACL DELUSER "$user" >/dev/null 2>&1 || return 1
        fi
    done < <(printf '%s\n' "$live_acl" | awk '$1=="user" && $2 ~ /^fm-tenant-/ { print $2 }')
}

for _ in $(seq 1 "${REDIS_ACL_RELOAD_RETRIES:-20}"); do
    if reconcile_acl; then
        exit 0
    fi
    sleep "${REDIS_ACL_RELOAD_SLEEP:-0.5}"
done

echo "ERROR: failed to reconcile Redis ACL in $container_name" >&2
exit 1
