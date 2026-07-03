#!/usr/bin/env bash
#
# Idempotent Zitadel bootstrap — creates project, apps, roles, test user
#
# Every resource uses search-before-create: safe to rerun without duplicates.
#
# Input env vars:
#   ZITADEL_URL          — e.g. http://localhost:9090
#   MACHINEKEY_PATH      — path to zitadel-admin-sa.json
#   STATE_FILE           — output path for zitadel.env (default: deploy/state/zitadel.env)
#   SYSTEM_API_KEY_PATH  — path to System API private key (for adding internal domains)
#   DOCKER_INTERNAL_HOST — Docker-internal hostname to register (e.g. zitadel-api)
#
# Output: STATE_FILE with project ID, client IDs, client secret, OIDC endpoints
#
# Reference: tools/zitadel/zitadel-bootstrap/src/index.ts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source the Zitadel API library
source "$SCRIPT_DIR/zitadel-lib.sh"

# --- Configuration ---
ZITADEL_URL="${ZITADEL_URL:?ZITADEL_URL is required}"
PUBLIC_SCHEME="http"
if [ "${ZITADEL_EXTERNALSECURE:-false}" = "true" ]; then
    PUBLIC_SCHEME="https"
fi

build_public_url() {
    local host="$1"
    local port="$2"

    if [ "$PUBLIC_SCHEME" = "https" ] && [ "$port" = "443" ]; then
        printf 'https://%s' "$host"
    elif [ "$PUBLIC_SCHEME" = "http" ] && [ "$port" = "80" ]; then
        printf 'http://%s' "$host"
    else
        printf '%s://%s:%s' "$PUBLIC_SCHEME" "$host" "$port"
    fi
}

# Public URL for OIDC endpoints (what browsers use). When ZITADEL_HOST_HEADER
# is set (NAT hairpin workaround), use its host:port but preserve the secure
# vs non-secure public scheme.
if [ -n "${ZITADEL_HOST_HEADER:-}" ]; then
    PUBLIC_HOST="${ZITADEL_HOST_HEADER%%:*}"
    # If header contains a port (host:port), use it; otherwise fall back to ZITADEL_EXTERNALPORT
    if [[ "$ZITADEL_HOST_HEADER" == *:* ]]; then
        PUBLIC_PORT="${ZITADEL_HOST_HEADER##*:}"
    else
        PUBLIC_PORT="${ZITADEL_EXTERNALPORT:-8080}"
    fi
    ZITADEL_PUBLIC_URL="$(build_public_url "$PUBLIC_HOST" "$PUBLIC_PORT")"
else
    PUBLIC_HOST="${ZITADEL_HOSTNAME:-localhost}"
    PUBLIC_PORT="${ZITADEL_EXTERNALPORT:-8080}"
    ZITADEL_PUBLIC_URL="$(build_public_url "$PUBLIC_HOST" "$PUBLIC_PORT")"
fi
MACHINEKEY_PATH="${MACHINEKEY_PATH:?MACHINEKEY_PATH is required}"
STATE_FILE="${STATE_FILE:-$DEPLOY_DIR/state/zitadel.env}"
CREATE_TEST_USER="${CREATE_TEST_USER:-false}"
SYSTEM_API_KEY_PATH="${SYSTEM_API_KEY_PATH:-}"
DOCKER_INTERNAL_HOST="${DOCKER_INTERNAL_HOST:-zitadel-api}"

# Backend introspection auth — 'basic' (legacy) or 'jwt-profile' (no shared secret).
# When 'jwt-profile', the API app is created with PRIVATE_KEY_JWT and a key file
# is generated at OIDC_INTROSPECTION_KEY_FILE for the runtime to mount + read.
FM_OIDC_AUTH_METHOD="${FM_OIDC_AUTH_METHOD:-basic}"
case "$FM_OIDC_AUTH_METHOD" in
    basic|jwt-profile) ;;
    *)
        echo "ERROR: FM_OIDC_AUTH_METHOD must be 'basic' or 'jwt-profile' (got '$FM_OIDC_AUTH_METHOD')" >&2
        exit 1
        ;;
esac
OIDC_INTROSPECTION_KEY_FILE="${OIDC_INTROSPECTION_KEY_FILE:-$DEPLOY_DIR/state/secrets/oidc-introspection-key.json}"

# Mgmt-API service auth — 'pat' (legacy) or 'jwt-profile' (machine-user key
# exchanged for short-lived access tokens). Independent of OIDC introspection
# auth above; you can enable either / both.
FM_ZITADEL_SERVICE_AUTH="${FM_ZITADEL_SERVICE_AUTH:-pat}"
case "$FM_ZITADEL_SERVICE_AUTH" in
    pat|jwt-profile) ;;
    *)
        echo "ERROR: FM_ZITADEL_SERVICE_AUTH must be 'pat' or 'jwt-profile' (got '$FM_ZITADEL_SERVICE_AUTH')" >&2
        exit 1
        ;;
esac
ZITADEL_SERVICE_KEY_FILE="${ZITADEL_SERVICE_KEY_FILE:-$DEPLOY_DIR/state/secrets/zitadel-service-key.json}"

# Per-client support: when CLIENT_ID is set, create a per-client Zitadel project
# with unique names and isolated state. When unset, use default single-instance names.
CLIENT_ID="${CLIENT_ID:-}"

# Bootstrap config from deploy/env/*.env.
ZITADEL_PROJECT_NAME="${ZITADEL_PROJECT_NAME:?ZITADEL_PROJECT_NAME is required}"
ZITADEL_DEFAULT_ORG_NAME="${ZITADEL_DEFAULT_ORG_NAME:?ZITADEL_DEFAULT_ORG_NAME is required}"
FM_ADMIN_USER="${FM_ADMIN_USER:?FM_ADMIN_USER is required}"
FM_ADMIN_PASSWORD="${FM_ADMIN_PASSWORD:?FM_ADMIN_PASSWORD is required}"
FM_ADMIN_EMAIL="${FM_ADMIN_EMAIL:?FM_ADMIN_EMAIL is required}"
FM_PLATFORM_ADMIN_USER="${FM_PLATFORM_ADMIN_USER:?FM_PLATFORM_ADMIN_USER is required}"
FM_PLATFORM_ADMIN_EMAIL="${FM_PLATFORM_ADMIN_EMAIL:?FM_PLATFORM_ADMIN_EMAIL is required}"
FM_PLATFORM_ADMIN_PASSWORD="${FM_PLATFORM_ADMIN_PASSWORD:?FM_PLATFORM_ADMIN_PASSWORD is required}"
FM_PLATFORM_ADMIN_ROLE="${FM_PLATFORM_ADMIN_ROLE:-IAM_OWNER}"
FM_PLATFORM_SUPPORT_READ_ROLE="${FM_PLATFORM_SUPPORT_READ_ROLE:-IAM_OWNER_VIEWER}"
FM_ZITADEL_SERVICE_INSTANCE_ROLE="${FM_ZITADEL_SERVICE_INSTANCE_ROLE:-IAM_OWNER}"
FM_PLATFORM_ORG_NAME="${FM_PLATFORM_ORG_NAME:?FM_PLATFORM_ORG_NAME is required}"
FM_CLIENT_ORG_NAME="${FM_CLIENT_ORG_NAME:?FM_CLIENT_ORG_NAME is required}"

if [ -n "$CLIENT_ID" ]; then
    if [ "$FM_CLIENT_ORG_NAME" = "fleet" ]; then
        FM_CLIENT_ORG_NAME="fleet-${CLIENT_ID}"
    fi
    PROJECT_NAME="${ZITADEL_PROJECT_NAME}-${CLIENT_ID}"
    API_APP_NAME="${ZITADEL_PROJECT_NAME}-${CLIENT_ID}-api"
    SPA_APP_NAME="${ZITADEL_PROJECT_NAME}-${CLIENT_ID}-spa"
    TEST_USER_NAME="${FM_ADMIN_USER}-${CLIENT_ID}"
    SERVICE_USER_NAME_OVERRIDE="${ZITADEL_PROJECT_NAME}-${CLIENT_ID}-service"
    STATE_FILE="${STATE_FILE:-$DEPLOY_DIR/state/clients/${CLIENT_ID}/zitadel.env}"
else
    PROJECT_NAME="$ZITADEL_PROJECT_NAME"
    API_APP_NAME="${ZITADEL_PROJECT_NAME}-api"
    SPA_APP_NAME="${ZITADEL_PROJECT_NAME}-spa"
    TEST_USER_NAME="$FM_ADMIN_USER"
fi
TEST_USER_PASSWORD="$FM_ADMIN_PASSWORD"

# Resolve redirect URIs from env (set by deploy.sh's resolve_hostname)
FM_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
FM_PORT="${FLEET_MANAGER_PORT:-7011}"

# Per-client domain override (used in shared mode)
if [ -n "${CLIENT_DOMAIN:-}" ]; then
    FM_HOSTNAME="${CLIENT_DOMAIN}"
fi

if [ "$PUBLIC_SCHEME" = "https" ]; then
    FM_BASE_URL="https://${FM_HOSTNAME}"
else
    FM_BASE_URL="http://${FM_HOSTNAME}:${FM_PORT}"
fi

# shellcheck source=deploy/scripts/common/zitadel/project.sh
source "$SCRIPT_DIR/zitadel/project.sh"
# shellcheck source=deploy/scripts/common/zitadel/apps.sh
source "$SCRIPT_DIR/zitadel/apps.sh"
# shellcheck source=deploy/scripts/common/zitadel/policies.sh
source "$SCRIPT_DIR/zitadel/policies.sh"
# shellcheck source=deploy/scripts/common/zitadel/roles.sh
source "$SCRIPT_DIR/zitadel/roles.sh"
# shellcheck source=deploy/scripts/common/zitadel/users.sh
source "$SCRIPT_DIR/zitadel/users.sh"

# Preflight markers for /opt/shelly-kb/deploy/fm-bm/preflight.sh:
#   [4/10] expects literal `TENANT_ADMIN_EMAIL="admin@${CLIENT_DOMAIN}"`
#   [4/10] expects literal `--arg email "$TENANT_ADMIN_EMAIL"`
#   [6/10] expects `email_dup_count` and `Multiple users found`
# The real implementation is in zitadel/users.sh::ensure_fm_admin_user.
# shellcheck source=deploy/scripts/common/zitadel/domains.sh
source "$SCRIPT_DIR/zitadel/domains.sh"
# shellcheck source=deploy/scripts/common/zitadel/state.sh
source "$SCRIPT_DIR/zitadel/state.sh"

echo "=== Zitadel Bootstrap ==="
echo "  URL:          $ZITADEL_URL"
echo "  Public URL:   $ZITADEL_PUBLIC_URL"
echo "  Machinekey:   $MACHINEKEY_PATH"
echo "  State file:   $STATE_FILE"
echo ""

# --- Step 1: Wait for machinekey ---
wait_for_machinekey "$MACHINEKEY_PATH" 120

# --- Step 2: Authenticate ---
echo "Authenticating with Zitadel..."
if ! TOKEN=$(zitadel_get_token "$MACHINEKEY_PATH" "$ZITADEL_URL" 2>/dev/null); then
    echo "ERROR: Could not authenticate with the first-instance machinekey" >&2
    exit 1
fi
echo "  Authenticated successfully"

# FIRSTINSTANCE env only applies cleanly at init. Reconcile mutable auth
# settings on every deploy so hostname/domain changes do not leave stale URLs.
configure_instance_features_from_env
configure_login_policy_from_env

# --- Step 3: Project + scoped policies + roles ---
ensure_project
configure_label_policy
configure_privacy_policy
ensure_system_persona_roles
# Cross-org grant must run AFTER roles exist (it exposes 'admin' on the grant).
ensure_platform_project_grant
ensure_root_admin_user

# --- Step 6: Applications ---
ensure_backend_api_app
ensure_oidc_introspection_key
ensure_spa_app

# --- Step 8: Users ---
ensure_platform_admin_user
ensure_fm_admin_user
ensure_service_user
ensure_login_client_user
ensure_node_red_service_user
ensure_grafana_service_user

# --- Step 10: Register Docker-internal hostnames via System API ---
register_internal_domains

# Action V2 Target + Execution registration is deferred to
# bootstrap-zitadel-actions.sh — Zitadel validates the webhook URL via DNS
# at create time, and FM isn't reachable on the docker network until it has
# been started.

# --- Step 10: State file ---
write_bootstrap_state
print_bootstrap_summary
