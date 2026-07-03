#!/usr/bin/env bash
# Render the bootstrap Redis aclfile. Per-tenant users are appended at client-add
# and preserved across base ACL reconciliation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="${STATE_DIR:-$DEPLOY_DIR/state}"

: "${REDIS_ADMIN_PASSWORD:?REDIS_ADMIN_PASSWORD is required}"
: "${REDIS_FM_PASSWORD:?REDIS_FM_PASSWORD is required}"
: "${REDIS_ZITADEL_PASSWORD:?REDIS_ZITADEL_PASSWORD is required}"

mkdir -p "$STATE_DIR"
# Lock the secret dir to the owner. Docker bind-mounts as root, so the in-
# container redis user still reads the ACL via the mount regardless.
chmod 0700 "$STATE_DIR"
aclfile_path="$STATE_DIR/redis-users.acl"

if [ -d "$aclfile_path" ]; then
    rmdir "$aclfile_path" 2>/dev/null || {
        echo "ERROR: $aclfile_path is a directory and is not empty" >&2
        exit 1
    }
fi

preserved_users=""
if [ -f "$aclfile_path" ]; then
    preserved_users="$(
        awk '
            $1 == "user" && $2 != "default" && $2 != "fm-admin" && $2 != "fm-default" && $2 != "zitadel" {
                print
            }
        ' "$aclfile_path"
    )"
fi

# In-place write — bind-mount tracks the inode; mv would leave the container on the old file.
{
    printf 'user default off\n'
    printf 'user fm-admin on >%s ~* &* +@all\n' "$REDIS_ADMIN_PASSWORD"
    printf 'user fm-default on >%s ~* &* +@all -@dangerous\n' "$REDIS_FM_PASSWORD"
    printf 'user zitadel on >%s ~* &* +@all -@dangerous +flushdb\n' "$REDIS_ZITADEL_PASSWORD"
    [ -n "$preserved_users" ] && printf '%s\n' "$preserved_users"
} > "$aclfile_path"
# 0644 so the redis user in the container can read regardless of host UID.
chmod 0644 "$aclfile_path"
echo "Wrote $aclfile_path"
