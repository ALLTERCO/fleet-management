#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/common/migrate-plan.sh
source "$SCRIPT_DIR/migrate-plan.sh"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_eq() {
    local expected="$1" actual="$2" label="$3"
    [ "$actual" = "$expected" ] || {
        printf 'expected: %q\nactual:   %q\n' "$expected" "$actual" >&2
        fail "$label"
    }
}

COMPOSE_PROJECT_NAME=fleet-test
ZITADEL_HOSTNAME=identity.example.test
ZITADEL_EXTERNALPORT=443
ZITADEL_EXTERNALSECURE=true
ZITADEL_PUBLIC_SCHEME=https
ZITADEL_TLS_MODE=external
DEPLOY_ZITADEL_HOSTNAME="$ZITADEL_HOSTNAME"
DEPLOY_ZITADEL_EXTERNALPORT="$ZITADEL_EXTERNALPORT"
DEPLOY_ZITADEL_EXTERNALSECURE="$ZITADEL_EXTERNALSECURE"
DEPLOY_ZITADEL_PUBLIC_SCHEME="$ZITADEL_PUBLIC_SCHEME"
DEPLOY_ZITADEL_TLS_MODE="$ZITADEL_TLS_MODE"

RUNTIME_HOST="$ZITADEL_HOSTNAME"
RUNTIME_PORT="$ZITADEL_EXTERNALPORT"
RUNTIME_SECURE="$ZITADEL_EXTERNALSECURE"

mp_running_container_env_value() {
    local _project="$1" _service="$2" key="$3"
    case "$key" in
        ZITADEL_EXTERNALDOMAIN) printf '%s' "$RUNTIME_HOST" ;;
        ZITADEL_EXTERNALPORT) printf '%s' "$RUNTIME_PORT" ;;
        ZITADEL_EXTERNALSECURE) printf '%s' "$RUNTIME_SECURE" ;;
        *) return 1 ;;
    esac
}

plan="$(mp_emit_zitadel_topology_setup v4.17.3 v4.17.3)"
assert_eq '' "$plan" 'matching live runtime should not emit setup'

# Regression: persisted metadata can say secure/443 while the existing
# container still runs the old insecure/9090 topology. The planner must use
# live container evidence rather than trusting the saved desired state.
RUNTIME_PORT=9090
RUNTIME_SECURE=false
plan="$(mp_emit_zitadel_topology_setup v4.17.3 v4.17.3)"
assert_eq $'zitadel_setup\tzitadel-api\tv4.17.3\tv4.17.3\treconcile running external URL config' \
    "$plan" 'live secure/port drift must emit setup'

RUNTIME_PORT=443
RUNTIME_SECURE=true
RUNTIME_HOST=old-identity.example.test
plan="$(mp_emit_zitadel_topology_setup v4.17.3 v4.17.3)"
assert_eq $'zitadel_setup\tzitadel-api\tv4.17.3\tv4.17.3\treconcile running external URL config' \
    "$plan" 'live external-domain drift must emit setup'

# Existing metadata-only reconciliation remains intact after runtime matches.
RUNTIME_HOST="$ZITADEL_HOSTNAME"
DEPLOY_ZITADEL_EXTERNALPORT=9090
plan="$(mp_emit_zitadel_topology_setup v4.17.3 v4.17.3)"
assert_eq $'zitadel_setup\tzitadel-api\tv4.17.3\tv4.17.3\treconcile external URL config' \
    "$plan" 'saved metadata drift must still emit setup'

printf 'ok - Zitadel live topology drift planning\n'
