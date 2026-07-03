#!/usr/bin/env bash
# Back up the Zitadel database before upgrade or migration operations.

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

ZITADEL_DB_CONTAINER="${ZITADEL_DB_CONTAINER:-fm-zitadel-db-1}"
ZITADEL_DB_NAME="${ZITADEL_DB_NAME:-zitadel}"
ZITADEL_DB_USER="${ZITADEL_DB_USER:-postgres}"
BACKUP_DIR="${FM_BACKUP_DIR:-$DEPLOY_DIR/state/backups/zitadel}"
RETAIN_DAYS="${FM_BACKUP_RETAIN_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/zitadel-${ts}.sql.gz"

echo "Dumping Zitadel DB ($ZITADEL_DB_NAME) -> $out"
docker exec "$ZITADEL_DB_CONTAINER" \
    pg_dump -U "$ZITADEL_DB_USER" \
        --schema=eventstore --schema=auth --schema=projections --schema=adminapi \
        --schema=public --schema=cache \
        -Fp --no-owner --no-privileges "$ZITADEL_DB_NAME" \
    | gzip -9 > "$out"
chmod 0600 "$out"

bytes="$(wc -c < "$out" | tr -d ' ')"
echo "  Wrote $bytes bytes"

echo "Pruning backups older than ${RETAIN_DAYS}d in $BACKUP_DIR"
find "$BACKUP_DIR" -name 'zitadel-*.sql.gz' -type f -mtime "+${RETAIN_DAYS}" -delete
remaining="$(find "$BACKUP_DIR" -name 'zitadel-*.sql.gz' -type f | wc -l | tr -d ' ')"
echo "  $remaining backup(s) retained"

if [ -n "${FM_BACKUP_S3_URI:-}" ]; then
    if ! command -v aws >/dev/null 2>&1; then
        echo "  WARN: FM_BACKUP_S3_URI set but aws CLI missing; skipping upload" >&2
    else
        echo "Uploading to ${FM_BACKUP_S3_URI%/}/$(basename "$out")"
        aws s3 cp --quiet "$out" "${FM_BACKUP_S3_URI%/}/$(basename "$out")"
    fi
fi

echo "Done"
