#!/usr/bin/env bash
# Provision the durable, read-only Redis account used by the host metrics exporter.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="${STATE_DIR:-$DEPLOY_DIR/state}"
REDIS_CONTAINER="${REDIS_CONTAINER:-fm-redis}"
REDIS_ACLFILE="${REDIS_ACLFILE:-$STATE_DIR/redis-users.acl}"
REDIS_MONITOR_CREDENTIAL_FILE="${REDIS_MONITOR_CREDENTIAL_FILE:-$STATE_DIR/redis-monitoring-passwords.json}"
REDIS_MONITOR_USER=bm-monitor
REDIS_MONITOR_ADDRESS="${REDIS_MONITOR_ADDRESS:-redis://$REDIS_MONITOR_USER@$REDIS_CONTAINER:6379}"
REDIS_MONITOR_LEGACY_ADDRESS="${REDIS_MONITOR_LEGACY_ADDRESS:-redis://$REDIS_CONTAINER:6379}"

MONITOR_WORK_DIR=""
MONITOR_BACKUP_FILE=""
MONITOR_PREVIOUS_LIVE_LINE=""
MONITOR_CREATED_CREDENTIAL=false
MONITOR_CREDENTIAL_CHANGED=false
MONITOR_CREDENTIAL_BACKUP=""
MONITOR_DURABLE_CHANGED=false
MONITOR_LIVE_CHANGED=false

: "${REDIS_ADMIN_PASSWORD:?REDIS_ADMIN_PASSWORD is required}"

log_info() { printf '%s\n' "$*"; }
log_warn() { printf 'WARN: %s\n' "$*" >&2; }
log_error() { printf 'ERROR: %s\n' "$*" >&2; }

# shellcheck source=deploy/scripts/common/update.sh
source "$DEPLOY_DIR/scripts/common/update.sh"
# shellcheck source=deploy/scripts/common/hostlock.sh
source "$DEPLOY_DIR/scripts/common/hostlock.sh"

admin_redis() {
    docker exec "$REDIS_CONTAINER" redis-cli \
        -e --user fm-admin --pass "$REDIS_ADMIN_PASSWORD" --no-auth-warning "$@"
}

monitor_redis() {
    local password="$1"
    shift
    docker exec "$REDIS_CONTAINER" redis-cli \
        -e --user "$REDIS_MONITOR_USER" --pass "$password" --no-auth-warning "$@"
}

credential_password() {
    python3 - "$REDIS_MONITOR_CREDENTIAL_FILE" "$REDIS_MONITOR_ADDRESS" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    credentials = json.load(source)
password = credentials.get(sys.argv[2])
if not isinstance(password, str) or not password:
    raise SystemExit("monitoring credential does not match the configured Redis address")
print(password)
PY
}

normalize_credential_file() {
    local normalized_file="$MONITOR_WORK_DIR/redis-monitoring-passwords.json"
    python3 - \
        "$REDIS_MONITOR_CREDENTIAL_FILE" \
        "$REDIS_MONITOR_LEGACY_ADDRESS" \
        "$REDIS_MONITOR_ADDRESS" \
        "$normalized_file" <<'PY'
import json
import sys

source_path, legacy_address, address, target_path = sys.argv[1:]
with open(source_path, encoding="utf-8") as source:
    credentials = json.load(source)
if not isinstance(credentials, dict):
    raise SystemExit("Redis monitoring credential file must contain a JSON object")

password = credentials.get(address)
legacy_password = credentials.get(legacy_address)
if password is not None and (not isinstance(password, str) or not password):
    raise SystemExit("Redis monitoring credential does not match the configured Redis address")
if legacy_password is not None and (not isinstance(legacy_password, str) or not legacy_password):
    raise SystemExit("legacy Redis monitoring credential is invalid")
if password and legacy_password and password != legacy_password:
    raise SystemExit("current and legacy Redis monitoring credentials disagree")
if not password:
    password = legacy_password
if not password:
    raise SystemExit("monitoring credential does not match the configured Redis address")

credentials.pop(legacy_address, None)
credentials[address] = password
with open(target_path, "w", encoding="utf-8") as target:
    json.dump(credentials, target, separators=(",", ":"), sort_keys=True)
    target.write("\n")
PY

    if ! cmp -s "$normalized_file" "$REDIS_MONITOR_CREDENTIAL_FILE"; then
        MONITOR_CREDENTIAL_BACKUP="$MONITOR_WORK_DIR/redis-monitoring-passwords.backup.json"
        cp -p "$REDIS_MONITOR_CREDENTIAL_FILE" "$MONITOR_CREDENTIAL_BACKUP"
        cat "$normalized_file" > "$REDIS_MONITOR_CREDENTIAL_FILE"
        chmod 0600 "$REDIS_MONITOR_CREDENTIAL_FILE"
        MONITOR_CREDENTIAL_CHANGED=true
    fi
}

restore_live_monitor() {
    local previous_line="$1"
    if [ -z "$previous_line" ]; then
        admin_redis ACL DELUSER "$REDIS_MONITOR_USER" >/dev/null 2>&1 || true
        return
    fi

    local -a parts=()
    read -r -a parts <<< "$previous_line"
    admin_redis ACL SETUSER "$REDIS_MONITOR_USER" reset "${parts[@]:2}" >/dev/null 2>&1 || true
}

cleanup() {
    local rc=$?
    set +e

    if [ "$rc" -ne 0 ]; then
        if [ "$MONITOR_DURABLE_CHANGED" = true ] && [ -n "$MONITOR_BACKUP_FILE" ]; then
            cat "$MONITOR_BACKUP_FILE" > "$REDIS_ACLFILE"
            chmod 0644 "$REDIS_ACLFILE"
        fi
        if [ "$MONITOR_LIVE_CHANGED" = true ]; then
            restore_live_monitor "$MONITOR_PREVIOUS_LIVE_LINE"
        fi
        if [ "$MONITOR_CREATED_CREDENTIAL" = true ]; then
            rm -f "$REDIS_MONITOR_CREDENTIAL_FILE"
        elif [ "$MONITOR_CREDENTIAL_CHANGED" = true ] && [ -n "$MONITOR_CREDENTIAL_BACKUP" ]; then
            cat "$MONITOR_CREDENTIAL_BACKUP" > "$REDIS_MONITOR_CREDENTIAL_FILE"
            chmod 0600 "$REDIS_MONITOR_CREDENTIAL_FILE"
        fi
    fi

    if [ -n "$MONITOR_WORK_DIR" ]; then
        rm -rf "$MONITOR_WORK_DIR"
    fi
    host_lock_release
    exit "$rc"
}

provision_monitoring_user() {
    if [ ! -s "$REDIS_ACLFILE" ]; then
        log_error "Redis ACL file is missing or empty: $REDIS_ACLFILE"
        return 1
    fi
    if ! docker ps --format '{{.Names}}' | grep -Fxq "$REDIS_CONTAINER"; then
        log_error "Redis container is not running: $REDIS_CONTAINER"
        return 1
    fi
    if ! admin_redis PING 2>/dev/null | grep -qx PONG; then
        log_error "Redis administrator authentication failed"
        return 1
    fi

    local durable_before live_before
    MONITOR_WORK_DIR="$(mktemp -d "$STATE_DIR/.redis-monitoring.XXXXXX")"
    durable_before="$MONITOR_WORK_DIR/durable-users"
    live_before="$MONITOR_WORK_DIR/live-users"
    awk '$1 == "user" { print $2 }' "$REDIS_ACLFILE" | sort -u > "$durable_before"
    admin_redis ACL LIST \
        | awk '$1 == "user" { print $2 }' \
        | sort -u > "$live_before"
    MONITOR_PREVIOUS_LIVE_LINE="$(admin_redis ACL LIST | awk -v u="$REDIS_MONITOR_USER" '$1 == "user" && $2 == u { print }')"

    local monitor_password
    if [ ! -f "$REDIS_MONITOR_CREDENTIAL_FILE" ]; then
        if [ -n "$MONITOR_PREVIOUS_LIVE_LINE" ]; then
            log_error "Live Redis already has $REDIS_MONITOR_USER but its durable credential is missing"
            return 1
        fi
        monitor_password="$(openssl rand -hex 32)"
        umask 077
        printf '{"%s":"%s"}\n' "$REDIS_MONITOR_ADDRESS" "$monitor_password" \
            > "$REDIS_MONITOR_CREDENTIAL_FILE"
        chmod 0600 "$REDIS_MONITOR_CREDENTIAL_FILE"
        MONITOR_CREATED_CREDENTIAL=true
    else
        normalize_credential_file
        monitor_password="$(credential_password)"
        chmod 0600 "$REDIS_MONITOR_CREDENTIAL_FILE"
    fi

    local backup_file="" next_acl acl_line
    next_acl="$MONITOR_WORK_DIR/redis-users.acl"
    acl_line="user $REDIS_MONITOR_USER reset on >$monitor_password ~* &* -@all +@connection +@read +info +config|get +client|list +client|setname +client|setinfo +slowlog|get +slowlog|len +latency|latest +latency|histogram +memory|stats"
    awk -v u="$REDIS_MONITOR_USER" '$1 == "user" && $2 == u { next } { print }' \
        "$REDIS_ACLFILE" > "$next_acl"
    printf '%s\n' "$acl_line" >> "$next_acl"

    if ! cmp -s "$next_acl" "$REDIS_ACLFILE"; then
        backup_file="$(mktemp "$STATE_DIR/redis-users.acl.backup.XXXXXX")"
        MONITOR_BACKUP_FILE="$backup_file"
        cp -p "$REDIS_ACLFILE" "$backup_file"
        chmod 0600 "$backup_file"
        MONITOR_DURABLE_CHANGED=true
        cat "$next_acl" > "$REDIS_ACLFILE"
        chmod 0644 "$REDIS_ACLFILE"
    fi

    local -a acl_parts=()
    read -r -a acl_parts <<< "$acl_line"
    local monitor_info="" verification_failed=false
    MONITOR_LIVE_CHANGED=true
    if ! admin_redis ACL SETUSER "$REDIS_MONITOR_USER" reset "${acl_parts[@]:2}" >/dev/null; then
        verification_failed=true
    else
        monitor_info="$(monitor_redis "$monitor_password" INFO server 2>/dev/null || true)"
        if ! monitor_redis "$monitor_password" PING 2>/dev/null | grep -qx PONG \
            || ! grep -q '^redis_version:' <<< "$monitor_info"; then
            verification_failed=true
        fi
    fi
    if [ "$verification_failed" = true ]; then
        log_error "Redis monitoring user verification failed"
        return 1
    fi

    local durable_after live_after
    durable_after="$MONITOR_WORK_DIR/durable-users-after"
    live_after="$MONITOR_WORK_DIR/live-users-after"
    awk '$1 == "user" { print $2 }' "$REDIS_ACLFILE" | sort -u > "$durable_after"
    admin_redis ACL LIST \
        | awk '$1 == "user" { print $2 }' \
        | sort -u > "$live_after"
    if [ -n "$(comm -23 "$durable_before" "$durable_after")" ] \
        || [ -n "$(comm -23 "$live_before" "$live_after")" ]; then
        log_error "Existing Redis users changed"
        return 1
    fi

    unset monitor_password
    log_info "Provisioned durable Redis monitoring user: $REDIS_MONITOR_USER"
    log_info "Credential file: $REDIS_MONITOR_CREDENTIAL_FILE"
    if [ -n "$backup_file" ]; then
        log_info "Backup kept: $backup_file"
    else
        log_info "Durable Redis ACL was already current"
    fi
}

host_lock_acquire "provision Redis monitoring user"
trap cleanup EXIT
provision_monitoring_user
