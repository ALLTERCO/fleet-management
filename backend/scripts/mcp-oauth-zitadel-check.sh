#!/usr/bin/env bash
# Runs the MCP browser sign-in proof against a local stack with real Zitadel.
# Usage: mcp-oauth-zitadel-check.sh <compose-project> <state-dir> [report.json]
# Needs a stack bootstrapped with the MCP apps (FM_MCP_OAUTH_CLIENT_IDS in its
# zitadel.env) and FM_PUBLIC_BASE_URL in its fm-runtime.env.
set -euo pipefail

PROJECT="${1:?compose project name, e.g. nrlocal}"
STATE_DIR="${2:?deploy state directory of that stack}"
OUTPUT="${3:-}"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

env_value() {
    local value
    value="$(grep -E "^$2=" "$STATE_DIR/$1" | tail -n 1 | cut -d= -f2-)"
    value="${value%\"}"
    value="${value#\"}"
    [ -n "$value" ] || { echo "$2 missing from $STATE_DIR/$1" >&2; exit 1; }
    printf '%s' "$value"
}

# Empty when the stack does not set it; the proof then assumes the code default.
optional_env_value() {
    { grep -E "^$2=" "$STATE_DIR/$1" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2- | tr -d '"'
}

container_ip() {
    docker inspect "$PROJECT-$1-1" \
        --format "{{with index .NetworkSettings.Networks \"${PROJECT}_fleet-net\"}}{{.IPAddress}}{{end}}"
}

# The stack's published Zitadel API port (deploy env ZITADEL_API_HOST_PORT).
ZITADEL_API_URL="${ZITADEL_API_URL:-http://127.0.0.1:8091}"
FLEET_IP="$(container_ip fleet-manager)"
[ -n "$FLEET_IP" ] || { echo "stack $PROJECT is not running" >&2; exit 1; }

cd "$BACKEND_DIR"
exec env \
    FM_MCP_OAUTH_CHECK_FLEET_URL="http://$FLEET_IP:7011" \
    FM_MCP_OAUTH_CHECK_PUBLIC_BASE_URL="$(env_value fm-runtime.env FM_PUBLIC_BASE_URL)" \
    FM_MCP_OAUTH_CHECK_SPA_REDIRECT_URI="$(env_value fm-runtime.env OIDC_REDIRECT_URI)" \
    FM_MCP_OAUTH_CHECK_ZITADEL_URL="$ZITADEL_API_URL" \
    FM_MCP_OAUTH_CHECK_ZITADEL_HOST="$(env_value .env ZITADEL_HOSTNAME)" \
    FM_MCP_OAUTH_CHECK_ISSUER="$(env_value zitadel.env ZITADEL_ISSUER_URL)" \
    FM_MCP_OAUTH_CHECK_SERVICE_TOKEN="$(env_value zitadel.env ZITADEL_SERVICE_TOKEN)" \
    FM_MCP_OAUTH_CHECK_LOGIN_TOKEN="$(env_value zitadel.env ZITADEL_LOGIN_CLIENT_TOKEN)" \
    FM_MCP_OAUTH_CHECK_ORG_ID="$(env_value zitadel.env FM_CLIENT_ORG_ID)" \
    FM_MCP_OAUTH_CHECK_PROJECT_ID="$(env_value zitadel.env ZITADEL_CLIENT_PROJECT_ID)" \
    FM_MCP_OAUTH_CHECK_SPA_CLIENT_ID="$(env_value zitadel.env ZITADEL_CLIENT_FRONTEND_CLIENT_ID)" \
    FM_MCP_OAUTH_CHECK_MCP_CLIENT_IDS="$(env_value zitadel.env FM_MCP_OAUTH_CLIENT_IDS)" \
    FM_MCP_OAUTH_CHECK_ACCOUNT_STATE_TTL_MS="${FM_MCP_OAUTH_CHECK_ACCOUNT_STATE_TTL_MS:-$(optional_env_value .env FM_ACCOUNT_STATE_TTL_MS)}" \
    FM_MCP_OAUTH_CHECK_OUTPUT="$OUTPUT" \
    node --import tsx scripts/mcp-oauth-zitadel-check.ts
