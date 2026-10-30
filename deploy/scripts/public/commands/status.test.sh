#!/usr/bin/env bash
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/public/commands/status.sh
source "$TEST_DIR/status.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

STATE_DIR="$tmp_dir/state"
DEPLOY_DIR="$tmp_dir/deploy"
COMPOSE_PROJECT_NAME="fleet-public"
FM_DEV_MODE=false
WITH_SSL=false
WITH_NODERED=false
ZITADEL_HOSTNAME="fleet.example.test"
ZITADEL_EXTERNALPORT=443
ZITADEL_EXTERNALSECURE=true
FLEET_MANAGER_PORT=7011
FM_VERSION=latest
OS=linux
ARCH=amd64
DISTRO=debian
GREEN=""
RED=""
RESET=""

mkdir -p "$STATE_DIR/contract"
printf '{}\n' >"$STATE_DIR/contract/manifest.json"

enable_debug_mode() { :; }
detect_os() { OS=linux; ARCH=amd64; DISTRO=debian; }
load_state_env() { :; }
load_deploy_meta() { :; }
step() { printf 'STEP %s\n' "$*"; }
info() { printf 'INFO %s\n' "$*"; }
warn() { printf 'WARN %s\n' "$*"; }
error() { printf 'ERROR %s\n' "$*" >&2; }
compose_cmd() {
    [ "${1:-}" = ps ] || return 1
    printf 'NAME STATUS PORTS\n'
}
container_name() {
    printf '%s-%s-1' "$COMPOSE_PROJECT_NAME" "$1"
}
hc_container_name() {
    case "$1" in
        zitadel-api) printf 'fm-zitadel-api-1' ;;
        *) printf '%s-%s-1' "$COMPOSE_PROJECT_NAME" "$1" ;;
    esac
}
container_health_status() {
    case "$1" in
        fleet-public-fleet-manager-1|fleet-public-fleet-db-1|fm-zitadel-api-1) printf 'healthy' ;;
        *) printf 'missing' ;;
    esac
}
manifest_path() { printf '%s/contract/manifest.json' "$STATE_DIR"; }
manifest_get_field() {
    case "$1" in
        .shared_services.fleet_manager.image) printf 'fleet-manager:latest' ;;
        .shared_services.fleet_db.image) printf 'timescale/timescaledb:2.21.0-pg17' ;;
        .identity.build_commit) printf 'old-commit' ;;
        .shared_services.fleet_manager.image_digest) printf 'sha256:old' ;;
        .env) printf 'public' ;;
        .mode) printf 'single-tenant' ;;
        .shared_services.fleet_manager.last_updated_at) printf '2026-08-28T12:00:00Z' ;;
    esac
}
docker() {
    [ "${1:-}" = inspect ] || return 1
    [ "${2:-}" = -f ] || return 1
    local template="$3" container="$4"
    case "$template:$container" in
        '{{.Config.Image}}:fleet-public-fleet-manager-1')
            printf 'homelab/shelly-fleet:1.91.0-organize-assignments-v12\n'
            ;;
        '{{.State.StartedAt}}:fleet-public-fleet-manager-1')
            printf '2026-10-28T07:00:00Z\n'
            ;;
        '{{.Config.Image}}:fleet-public-fleet-db-1')
            printf 'timescale/timescaledb:2.22.1-pg18\n'
            ;;
        *) return 1 ;;
    esac
}
_status_show_db_runtime() { :; }

pass_action_hooks() { return 0; }
fail_action_hooks() { return 1; }

# The real compatibility resolver must find the fixed shared provider name even
# when the active public Compose project is fleet-public.
(
    # shellcheck source=deploy/scripts/common/compat.sh
    source "$TEST_DIR/../../common/compat.sh"
    # shellcheck source=deploy/scripts/common/healthwait.sh
    source "$TEST_DIR/../../common/healthwait.sh"
    docker() {
        if [ "${1:-}" = ps ] && [ "${4:-}" = 'name=^fm-zitadel-api-1$' ]; then
            printf 'provider-container-id\n'
        fi
    }
    resolved="$(hc_container_name zitadel-api)"
    if [ "$resolved" != "fm-zitadel-api-1" ]; then
        echo "shared Zitadel provider did not resolve: $resolved" >&2
        exit 1
    fi
)

# Healthy shared-provider topology resolves the fixed fm-zitadel-api-1 name,
# reports the live Fleet image instead of the static manifest image, and exits 0.
(
    _status_show_zitadel_actions() { pass_action_hooks; }
    output="$(cmd_status 2>&1)"
    printf '%s\n' "$output" | grep -F 'zitadel-api [shared: fm-zitadel-api-1]' >/dev/null
    printf '%s\n' "$output" | grep -F 'homelab/shelly-fleet:1.91.0-organize-assignments-v12' >/dev/null
    printf '%s\n' "$output" | grep -F 'Started      2026-10-28T07:00:00Z' >/dev/null
    printf '%s\n' "$output" | grep -F 'Manifest Fleet image fleet-manager:latest recorded 2026-08-28T12:00:00Z differs from the live container' >/dev/null
    if printf '%s\n' "$output" | grep -F 'Fleet image  fleet-manager:latest' >/dev/null; then
        echo "status preferred stale manifest image over live runtime" >&2
        exit 1
    fi
    if printf '%s\n' "$output" | grep -F 'INFO Updated  2026-08-28T12:00:00Z' >/dev/null; then
        echo "status presented stale manifest timestamp as the live deployment update" >&2
        exit 1
    fi
)

# A failed Action Hook verification must make the top-level status command fail.
(
    _status_show_zitadel_actions() { fail_action_hooks; }
    if cmd_status >/dev/null 2>&1; then
        echo "status succeeded despite failed Action Hook verification" >&2
        exit 1
    fi
)

# A missing/unhealthy checked service must also make status fail.
(
    _status_show_zitadel_actions() { pass_action_hooks; }
    container_health_status() {
        case "$1" in
            fleet-public-fleet-db-1) printf 'unhealthy' ;;
            *) printf 'healthy' ;;
        esac
    }
    if cmd_status >/dev/null 2>&1; then
        echo "status succeeded despite unhealthy fleet-db" >&2
        exit 1
    fi
)

# Losing the Compose status query itself is also a failed diagnostic, even if
# direct container probes happen to succeed.
(
    _status_show_zitadel_actions() { pass_action_hooks; }
    compose_cmd() { return 17; }
    if cmd_status >/dev/null 2>&1; then
        echo "status succeeded despite failed docker compose ps" >&2
        exit 1
    fi
)

# The real Action Hook wrapper must preserve a checker failure instead of
# turning the diagnostic into a successful status result.
(
    mkdir -p "$STATE_DIR/machinekey"
    : >"$STATE_DIR/machinekey/zitadel-admin-sa.json"
    : >"$STATE_DIR/zitadel.env"
    bash() { return 23; }
    if _status_show_zitadel_actions >/dev/null 2>&1; then
        echo "Action Hook wrapper swallowed checker failure" >&2
        exit 1
    fi
)

echo "status tests passed"
