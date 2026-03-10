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
#   DOCKER_INTERNAL_HOST — Docker-internal hostname to register (e.g. zitadel)
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
# Public URL for OIDC endpoints (what browsers use). When ZITADEL_HOST_HEADER
# is set (NAT hairpin workaround), the public URL uses the real hostname;
# otherwise it's the same as ZITADEL_URL.
if [ -n "${ZITADEL_HOST_HEADER:-}" ]; then
    ZITADEL_PUBLIC_URL="http://${ZITADEL_HOST_HEADER}"
else
    ZITADEL_PUBLIC_URL="$ZITADEL_URL"
fi
MACHINEKEY_PATH="${MACHINEKEY_PATH:?MACHINEKEY_PATH is required}"
STATE_FILE="${STATE_FILE:-$DEPLOY_DIR/state/zitadel.env}"
CREATE_TEST_USER="${CREATE_TEST_USER:-false}"
SYSTEM_API_KEY_PATH="${SYSTEM_API_KEY_PATH:-}"
DOCKER_INTERNAL_HOST="${DOCKER_INTERNAL_HOST:-zitadel}"

# Per-client support: when CLIENT_ID is set, create a per-client Zitadel project
# with unique names and isolated state. When unset, use default single-instance names.
CLIENT_ID="${CLIENT_ID:-}"

if [ -n "$CLIENT_ID" ]; then
    PROJECT_NAME="fleet-management-${CLIENT_ID}"
    API_APP_NAME="fleet-management-${CLIENT_ID}-api"
    SPA_APP_NAME="fleet-management-${CLIENT_ID}-spa"
    TEST_USER_NAME="fm-admin-${CLIENT_ID}"
    SERVICE_USER_NAME_OVERRIDE="fleet-management-${CLIENT_ID}-service"
    STATE_FILE="${STATE_FILE:-$DEPLOY_DIR/state/clients/${CLIENT_ID}/zitadel.env}"
else
    PROJECT_NAME="fleet-management"
    API_APP_NAME="fleet-management-api"
    SPA_APP_NAME="fleet-management-spa"
    TEST_USER_NAME="fm-admin"
fi
TEST_USER_PASSWORD="Admin123!"

# Resolve redirect URIs from env (set by deploy.sh's resolve_hostname)
FM_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
FM_PORT="${FLEET_MANAGER_PORT:-7011}"

# Per-client domain override (used in shared mode)
if [ -n "${CLIENT_DOMAIN:-}" ]; then
    FM_BASE_URL="http://${CLIENT_DOMAIN}:${FM_PORT}"
else
    FM_BASE_URL="http://${FM_HOSTNAME}:${FM_PORT}"
fi

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
TOKEN=$(zitadel_get_token "$MACHINEKEY_PATH" "$ZITADEL_URL")
echo "  Authenticated successfully"

# --- Helper: extract from search results ---
# Usage: search_by_name <api_path> <search_body> <result_key>
# Returns: JSON of first matching result, or empty string
search_resource() {
    local path="$1"
    local body="$2"
    local result_key="$3"

    local response
    response=$(zitadel_api "POST" "$path" "$body" "$TOKEN" "$ZITADEL_URL")

    # Extract first result from the result array
    echo "$response" | jq -r "(.${result_key} // []) | .[0] // empty"
}

# --- Step 3: Project ---
echo ""
echo "--- Project: $PROJECT_NAME ---"

existing_project=$(search_resource \
    "/management/v1/projects/_search" \
    "{\"queries\":[{\"nameQuery\":{\"name\":\"${PROJECT_NAME}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
    "result")

if [ -n "$existing_project" ]; then
    PROJECT_ID=$(echo "$existing_project" | jq -r '.id')
    echo "  Project exists: $PROJECT_ID"
else
    echo "  Creating project..."
    create_response=$(zitadel_api "POST" "/management/v1/projects" \
        "{\"name\":\"${PROJECT_NAME}\",\"projectRoleAssertion\":true,\"projectRoleCheck\":true,\"hasProjectCheck\":true}" \
        "$TOKEN" "$ZITADEL_URL")
    PROJECT_ID=$(echo "$create_response" | jq -r '.id')
    echo "  Created project: $PROJECT_ID"
fi

# --- Step 4: Update project settings (PUT is idempotent) ---
echo "  Updating project settings (role assertion enabled)..."
zitadel_api "PUT" "/management/v1/projects/${PROJECT_ID}" \
    "{\"name\":\"${PROJECT_NAME}\",\"projectRoleAssertion\":true,\"projectRoleCheck\":true,\"hasProjectCheck\":true}" \
    "$TOKEN" "$ZITADEL_URL" >/dev/null

# --- Step 5: Roles (bulk add — Zitadel ignores duplicates) ---
echo "  Adding roles (admin, installer, viewer)..."
zitadel_api "POST" "/management/v1/projects/${PROJECT_ID}/roles/_bulk" \
    "{\"roles\":[{\"key\":\"admin\",\"displayName\":\"Administrator\"},{\"key\":\"installer\",\"displayName\":\"Installer\"},{\"key\":\"viewer\",\"displayName\":\"Viewer\"}]}" \
    "$TOKEN" "$ZITADEL_URL" >/dev/null
echo "  Roles added"

# --- Step 5b: Grant root user admin role (required because projectRoleCheck is enabled) ---
echo "  Granting root user admin role on project..."
# Find the root human user (created by Zitadel start-from-init)
ROOT_USER_ID=$(search_resource \
    "/v2/users" \
    "{\"queries\":[{\"typeQuery\":{\"type\":\"TYPE_HUMAN\"}}],\"sortingColumn\":\"USER_FIELD_NAME_CREATION_DATE\",\"limit\":1}" \
    "result" | jq -r '.userId // .id // empty')

if [ -n "$ROOT_USER_ID" ]; then
    # Grant admin role (409 "already exists" is expected on rerun — ignore it)
    grant_response=$(zitadel_api "POST" "/management/v1/users/${ROOT_USER_ID}/grants" \
        "{\"projectId\":\"${PROJECT_ID}\",\"roleKeys\":[\"admin\"]}" \
        "$TOKEN" "$ZITADEL_URL" 2>&1 || true)
    echo "  Root user ($ROOT_USER_ID) granted admin role"
else
    echo "  WARNING: Could not find root user to grant admin role" >&2
fi

# --- Step 6: API app (backend) ---
echo ""
echo "--- API App: $API_APP_NAME ---"

existing_api_app=$(search_resource \
    "/management/v1/projects/${PROJECT_ID}/apps/_search" \
    "{\"queries\":[{\"nameQuery\":{\"name\":\"${API_APP_NAME}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
    "result")

BACKEND_CLIENT_ID=""
BACKEND_CLIENT_SECRET=""

if [ -n "$existing_api_app" ]; then
    BACKEND_APP_ID=$(echo "$existing_api_app" | jq -r '.id')
    BACKEND_CLIENT_ID=$(echo "$existing_api_app" | jq -r '.apiConfig.clientId // .oidcConfig.clientId // empty')
    echo "  API app exists: $BACKEND_APP_ID (clientId: $BACKEND_CLIENT_ID)"

    # Try to read secret from existing state file
    if [ -f "$STATE_FILE" ]; then
        BACKEND_CLIENT_SECRET=$(grep -oP '^ZITADEL_BACKEND_CLIENT_SECRET=\K.*' "$STATE_FILE" 2>/dev/null || true)
    fi

    # If no secret available, regenerate
    if [ -z "$BACKEND_CLIENT_SECRET" ]; then
        echo "  No saved secret found — regenerating client secret..."
        secret_response=$(zitadel_api "POST" \
            "/management/v1/projects/${PROJECT_ID}/apps/${BACKEND_APP_ID}/api_client_secret" \
            "{}" "$TOKEN" "$ZITADEL_URL")
        BACKEND_CLIENT_SECRET=$(echo "$secret_response" | jq -r '.clientSecret // empty')
        if [ -z "$BACKEND_CLIENT_SECRET" ]; then
            echo "  WARNING: Could not regenerate secret. Check Zitadel API response." >&2
            echo "  Response: $(echo "$secret_response" | jq 'del(.clientSecret, .token)' 2>/dev/null || echo '[redacted]')" >&2
        else
            echo "  Secret regenerated"
        fi
    else
        echo "  Using saved secret from state file"
    fi
else
    echo "  Creating API app (auth method: BASIC)..."
    # KEY FIX: Use API_AUTH_METHOD_TYPE_BASIC, not PRIVATE_KEY_JWT
    # Backend ZitadelService.ts expects authorization.type: "basic"
    api_response=$(zitadel_api "POST" "/management/v1/projects/${PROJECT_ID}/apps/api" \
        "{\"name\":\"${API_APP_NAME}\",\"authMethodType\":\"API_AUTH_METHOD_TYPE_BASIC\"}" \
        "$TOKEN" "$ZITADEL_URL")
    BACKEND_APP_ID=$(echo "$api_response" | jq -r '.appId // .id')
    BACKEND_CLIENT_ID=$(echo "$api_response" | jq -r '.clientId')
    BACKEND_CLIENT_SECRET=$(echo "$api_response" | jq -r '.clientSecret')
    echo "  Created API app: $BACKEND_APP_ID (clientId: $BACKEND_CLIENT_ID)"
fi

# --- Step 7: SPA app (frontend) ---
echo ""
echo "--- SPA App: $SPA_APP_NAME ---"

existing_spa_app=$(search_resource \
    "/management/v1/projects/${PROJECT_ID}/apps/_search" \
    "{\"queries\":[{\"nameQuery\":{\"name\":\"${SPA_APP_NAME}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
    "result")

FRONTEND_CLIENT_ID=""

if [ -n "$existing_spa_app" ]; then
    FRONTEND_APP_ID=$(echo "$existing_spa_app" | jq -r '.id')
    FRONTEND_CLIENT_ID=$(echo "$existing_spa_app" | jq -r '.oidcConfig.clientId // empty')
    echo "  SPA app exists: $FRONTEND_APP_ID (clientId: $FRONTEND_CLIENT_ID)"
else
    echo "  Creating SPA app (PKCE, devMode=true for HTTP redirects)..."
    echo "  Redirect URI: ${FM_BASE_URL}/callback"
    spa_response=$(zitadel_api "POST" "/management/v1/projects/${PROJECT_ID}/apps/oidc" \
        "{\"name\":\"${SPA_APP_NAME}\",\"responseTypes\":[\"OIDC_RESPONSE_TYPE_CODE\"],\"grantTypes\":[\"OIDC_GRANT_TYPE_AUTHORIZATION_CODE\"],\"appType\":\"OIDC_APP_TYPE_USER_AGENT\",\"authMethodType\":\"OIDC_AUTH_METHOD_TYPE_NONE\",\"redirectUris\":[\"${FM_BASE_URL}/callback\"],\"postLogoutRedirectUris\":[\"${FM_BASE_URL}/\"],\"accessTokenType\":\"OIDC_TOKEN_TYPE_BEARER\",\"accessTokenRoleAssertion\":true,\"idTokenRoleAssertion\":true,\"idTokenUserinfoAssertion\":true,\"devMode\":true}" \
        "$TOKEN" "$ZITADEL_URL")
    FRONTEND_APP_ID=$(echo "$spa_response" | jq -r '.appId // .id')
    FRONTEND_CLIENT_ID=$(echo "$spa_response" | jq -r '.clientId')
    echo "  Created SPA app: $FRONTEND_APP_ID (clientId: $FRONTEND_CLIENT_ID)"
fi

# Always update SPA OIDC config (ensures devMode, redirect URIs, and token settings are current)
echo "  Updating SPA OIDC config (devMode=true, redirect URIs)..."
zitadel_api "PUT" "/management/v1/projects/${PROJECT_ID}/apps/${FRONTEND_APP_ID}/oidc_config" \
    "{\"responseTypes\":[\"OIDC_RESPONSE_TYPE_CODE\"],\"grantTypes\":[\"OIDC_GRANT_TYPE_AUTHORIZATION_CODE\"],\"appType\":\"OIDC_APP_TYPE_USER_AGENT\",\"authMethodType\":\"OIDC_AUTH_METHOD_TYPE_NONE\",\"redirectUris\":[\"${FM_BASE_URL}/callback\"],\"postLogoutRedirectUris\":[\"${FM_BASE_URL}/\"],\"accessTokenType\":\"OIDC_TOKEN_TYPE_BEARER\",\"accessTokenRoleAssertion\":true,\"idTokenRoleAssertion\":true,\"idTokenUserinfoAssertion\":true,\"devMode\":true}" \
    "$TOKEN" "$ZITADEL_URL" >/dev/null
echo "  SPA config updated"

# --- Step 8: FM admin user (always created for Fleet Manager access) ---
echo ""
echo "--- FM Admin User: $TEST_USER_NAME ---"

existing_user=$(search_resource \
    "/v2/users" \
    "{\"queries\":[{\"userNameQuery\":{\"userName\":\"${TEST_USER_NAME}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
    "result")

if [ -n "$existing_user" ]; then
    TEST_USER_ID=$(echo "$existing_user" | jq -r '.userId // .id')
    echo "  FM admin user exists: $TEST_USER_ID"
else
    echo "  Creating FM admin user (v2 API — pre-verified, no password change)..."
    # Use v2 API: properly initializes user with verified email and password set
    # v1 API leaves user in "not initialized" state requiring email verification on first login
    user_response=$(zitadel_api "POST" "/v2/users/human" \
        "{\"username\":\"${TEST_USER_NAME}\",\"profile\":{\"givenName\":\"FM\",\"familyName\":\"Admin\",\"displayName\":\"FM Admin\"},\"email\":{\"email\":\"admin@fleet.local\",\"isVerified\":true},\"password\":{\"password\":\"${TEST_USER_PASSWORD}\",\"changeRequired\":false}}" \
        "$TOKEN" "$ZITADEL_URL")
    TEST_USER_ID=$(echo "$user_response" | jq -r '.userId // .id')
    echo "  Created FM admin user: $TEST_USER_ID"

    # Grant admin role
    echo "  Granting admin role..."
    grant_response=$(zitadel_api "POST" "/management/v1/users/${TEST_USER_ID}/grants" \
        "{\"projectId\":\"${PROJECT_ID}\",\"roleKeys\":[\"admin\"]}" \
        "$TOKEN" "$ZITADEL_URL" 2>&1 || true)
    echo "  Admin role granted"
fi

# --- Step 9: Service user for FM backend (Management API access) ---
# The backend needs to call Zitadel Management API to read user metadata
# (fm_permissions). API apps can only do token introspection, not obtain
# their own tokens. A service user (machine user) with a PAT solves this.
SERVICE_USER_NAME="${SERVICE_USER_NAME_OVERRIDE:-fleet-management-service}"
echo ""
echo "--- Service User: $SERVICE_USER_NAME ---"

# PAT expiry: 1 year from now (works on GNU date and BSD date)
PAT_EXPIRY=$(date -u -d "+365 days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
          || date -u -v+365d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
          || echo "")
PAT_BODY="{}"
if [ -n "$PAT_EXPIRY" ]; then
    PAT_BODY="{\"expirationDate\": \"$PAT_EXPIRY\"}"
    echo "  PAT expiry: $PAT_EXPIRY"
fi

SERVICE_PAT=""

# Search for existing machine user
existing_service_user=$(search_resource \
    "/v2/users" \
    "{\"queries\":[{\"userNameQuery\":{\"userName\":\"${SERVICE_USER_NAME}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
    "result")

if [ -n "$existing_service_user" ]; then
    SERVICE_USER_ID=$(echo "$existing_service_user" | jq -r '.userId // .id')
    echo "  Service user exists: $SERVICE_USER_ID"

    # Try to read PAT from existing state file
    if [ -f "$STATE_FILE" ]; then
        SERVICE_PAT=$(grep -oP '^ZITADEL_SERVICE_TOKEN=\K.*' "$STATE_FILE" 2>/dev/null || true)
    fi

    if [ -n "$SERVICE_PAT" ]; then
        echo "  Using saved PAT from state file"
    else
        echo "  No saved PAT found — generating new PAT..."
        pat_response=$(zitadel_api "POST" \
            "/management/v1/users/${SERVICE_USER_ID}/pats" \
            "$PAT_BODY" "$TOKEN" "$ZITADEL_URL")
        SERVICE_PAT=$(echo "$pat_response" | jq -r '.token // empty')
        if [ -z "$SERVICE_PAT" ]; then
            echo "  WARNING: Could not generate PAT. Response: $(echo "$pat_response" | jq 'del(.token)' 2>/dev/null || echo '[redacted]')" >&2
        else
            echo "  PAT generated"
        fi
    fi
else
    echo "  Creating service user (machine type)..."
    su_response=$(zitadel_api "POST" "/management/v1/users/machine" \
        "{\"userName\":\"${SERVICE_USER_NAME}\",\"name\":\"Fleet Manager Service\",\"description\":\"Backend service account for Management API access\",\"accessTokenType\":\"ACCESS_TOKEN_TYPE_BEARER\"}" \
        "$TOKEN" "$ZITADEL_URL")
    SERVICE_USER_ID=$(echo "$su_response" | jq -r '.userId // .id')
    echo "  Created service user: $SERVICE_USER_ID"

    # Generate PAT
    echo "  Generating PAT..."
    pat_response=$(zitadel_api "POST" \
        "/management/v1/users/${SERVICE_USER_ID}/pats" \
        "$PAT_BODY" "$TOKEN" "$ZITADEL_URL")
    SERVICE_PAT=$(echo "$pat_response" | jq -r '.token // empty')
    if [ -z "$SERVICE_PAT" ]; then
        echo "  WARNING: Could not generate PAT. Response: $(echo "$pat_response" | jq 'del(.token)' 2>/dev/null || echo '[redacted]')" >&2
    else
        echo "  PAT generated"
    fi
fi

# Grant ORG_USER_MANAGER role (can read user metadata in this org)
# 409 "already exists" is expected on rerun — ignore it
if [ -n "$SERVICE_USER_ID" ]; then
    echo "  Granting ORG_USER_MANAGER role..."
    zitadel_api "POST" "/management/v1/orgs/me/members" \
        "{\"userId\":\"${SERVICE_USER_ID}\",\"roles\":[\"ORG_USER_MANAGER\"]}" \
        "$TOKEN" "$ZITADEL_URL" 2>&1 | grep -v '"already exists"' || true
    echo "  Role granted"
fi

# --- Step 10: Register Docker-internal hostname via System API ---
# This allows containers to reach Zitadel at http://zitadel:8080
# instead of going through the external IP. Zitadel matches the Host header against
# registered instance domains — without this, internal requests get 404.
if [ -n "$SYSTEM_API_KEY_PATH" ] && [ -f "$SYSTEM_API_KEY_PATH" ]; then
    echo ""
    echo "--- Docker Internal Domain: $DOCKER_INTERNAL_HOST ---"
    system_api_add_instance_domain "$ZITADEL_URL" "$SYSTEM_API_KEY_PATH" "$DOCKER_INTERNAL_HOST"
else
    echo ""
    echo "  Skipping internal domain registration (no System API key)"
fi

# --- Step 10: Write state file ---
echo ""
echo "--- Writing state file: $STATE_FILE ---"

mkdir -p "$(dirname "$STATE_FILE")"

# Write atomically via temp file; clean up on error
TEMP_STATE=$(mktemp)
trap 'rm -f "$TEMP_STATE"' EXIT
cat > "$TEMP_STATE" <<EOF
# Auto-generated by bootstrap-zitadel.sh — do not edit manually
# Re-run bootstrap to regenerate
ZITADEL_PROJECT_ID=${PROJECT_ID}
ZITADEL_BACKEND_APP_ID=${BACKEND_APP_ID}
ZITADEL_BACKEND_CLIENT_ID=${BACKEND_CLIENT_ID}
ZITADEL_BACKEND_CLIENT_SECRET=${BACKEND_CLIENT_SECRET}
ZITADEL_FRONTEND_APP_ID=${FRONTEND_APP_ID}
ZITADEL_FRONTEND_CLIENT_ID=${FRONTEND_CLIENT_ID}
ZITADEL_ISSUER_URL=${ZITADEL_PUBLIC_URL}
ZITADEL_AUTH_ENDPOINT=${ZITADEL_PUBLIC_URL}/oauth/v2/authorize
ZITADEL_TOKEN_ENDPOINT=${ZITADEL_PUBLIC_URL}/oauth/v2/token
ZITADEL_USERINFO_ENDPOINT=${ZITADEL_PUBLIC_URL}/oidc/v1/userinfo
ZITADEL_END_SESSION_ENDPOINT=${ZITADEL_PUBLIC_URL}/oidc/v1/end_session
ZITADEL_SERVICE_TOKEN=${SERVICE_PAT}
EOF

chmod 0600 "$TEMP_STATE"
mv "$TEMP_STATE" "$STATE_FILE"

echo "  State file written"
echo ""
echo "=== Bootstrap complete ==="
echo "  Project:          $PROJECT_ID"
echo "  Backend client:   $BACKEND_CLIENT_ID"
echo "  Frontend client:  $FRONTEND_CLIENT_ID"
echo "  Service user:     ${SERVICE_USER_ID:-none}"
echo "  Service PAT:      ${SERVICE_PAT:+configured}"
