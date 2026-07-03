#!/usr/bin/env bash
# Reload Redis ACL from the bind-mounted aclfile when Redis is already running.

set -euo pipefail

: "${REDIS_ADMIN_PASSWORD:?REDIS_ADMIN_PASSWORD is required}"

container_name="${REDIS_CONTAINER:-fm-redis}"

if ! docker ps --format '{{.Names}}' | grep -Fxq "$container_name"; then
    exit 0
fi

for _ in $(seq 1 "${REDIS_ACL_RELOAD_RETRIES:-20}"); do
    if docker exec "$container_name" redis-cli \
        --user fm-admin --pass "$REDIS_ADMIN_PASSWORD" --no-auth-warning \
        ACL LOAD >/dev/null 2>&1; then
        exit 0
    fi
    sleep "${REDIS_ACL_RELOAD_SLEEP:-0.5}"
done

echo "ERROR: failed to reload Redis ACL in $container_name" >&2
exit 1
