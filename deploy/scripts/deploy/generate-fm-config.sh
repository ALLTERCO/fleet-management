#!/usr/bin/env bash
#
# Generate Fleet Manager OIDC config from Zitadel bootstrap state
#
# Two modes:
#   --mode zitadel  — Read deploy/state/zitadel.env, generate OIDC env for Docker compose
#   --mode dev      — Generate .fleet-managerrc with dev-mode: true (no Zitadel needed)
#
# Usage:
#   generate-fm-config.sh --mode zitadel [--target docker|local]
#   generate-fm-config.sh --mode dev
#
# For Docker (core/full profiles):
#   Output: deploy/state/fm-oidc.env (loaded via --env-file in compose)
#   Backend authority: http://zitadel:8080 (Docker internal)
#   Frontend authority: http://<hostname>:<port> (browser-accessible)
#
# For local dev (--env dev):
#   Output: $REPO_ROOT/.fleet-managerrc (rc config file)
#   Both authorities use localhost URLs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"

# --- Parse arguments ---
MODE=""
TARGET="docker"
CLIENT_ID=""

while [ $# -gt 0 ]; do
    case "$1" in
        --mode)   MODE="$2"; shift 2 ;;
        --target) TARGET="$2"; shift 2 ;;
        --client) CLIENT_ID="$2"; shift 2 ;;
        *)        echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

if [ -z "$MODE" ]; then
    echo "ERROR: --mode is required (zitadel or dev)" >&2
    exit 1
fi

# --- Mode B: Dev mode (no Zitadel) ---
if [ "$MODE" = "dev" ]; then
    echo "=== Generating dev-mode config ==="

    # Use .fleet-managerrc.dev as base if it exists, otherwise generate
    RC_FILE="$REPO_ROOT/.fleet-managerrc"
    DB_PORT="${POSTGRES_PORT:-5434}"
    DB_HOST="${POSTGRES_HOST:-localhost}"
    DB_USER="${POSTGRES_USER:-fleet}"
    DB_PASSWORD="${POSTGRES_PASSWORD:-fleet}"
    DB_NAME="${POSTGRES_DB:-fleet}"
    FM_PORT="${FLEET_MANAGER_PORT:-7011}"

    cat > "$RC_FILE" <<RCEOF
{
  "dev-mode": true,
  "internalStorage": {
    "connection": {
      "host": "${DB_HOST}",
      "port": ${DB_PORT},
      "user": "${DB_USER}",
      "password": "${DB_PASSWORD}",
      "database": "${DB_NAME}",
      "max": 40,
      "connectionTimeoutMillis": 7000,
      "idleTimeoutMillis": 15000,
      "allowExitOnIdle": true
    },
    "schema": "migration",
    "cwd": [
      "./db/migration/postgresql/logging",
      "./db/migration/postgresql/organization",
      "./db/migration/postgresql/user",
      "./db/migration/postgresql/ui",
      "./db/migration/postgresql/device",
      "./db/migration/postgresql/device/groups",
      "./db/migration/postgresql/device/em",
      "./db/migration/postgresql/notifications"
    ],
    "link": {
      "schemas": ["device", "user", "ui", "organization", "device_em", "logging", "notifications"]
    }
  },
  "components": {
    "web": {
      "port": ${FM_PORT},
      "port_ssl": -1,
      "jwt_token": "dev-secret-token-change-in-production",
      "relativeClientPath": "../../../../frontend/dist"
    }
  },
  "logger": {
    "appenders": { "console": { "type": "console" } },
    "categories": { "default": { "appenders": ["console"], "level": "debug" } }
  }
}
RCEOF

    echo "  Generated: $RC_FILE"
    echo "  Dev mode enabled — login with admin/admin"
    exit 0
fi

# --- Mode A: Zitadel OIDC ---
if [ "$MODE" != "zitadel" ]; then
    echo "ERROR: Unknown mode '$MODE' (expected: zitadel or dev)" >&2
    exit 1
fi

# Per-client support: read/write from client-specific state directory
if [ -n "$CLIENT_ID" ]; then
    STATE_FILE="$DEPLOY_DIR/state/clients/${CLIENT_ID}/zitadel.env"
else
    STATE_FILE="$DEPLOY_DIR/state/zitadel.env"
fi

if [ ! -f "$STATE_FILE" ]; then
    echo "ERROR: State file not found: $STATE_FILE" >&2
    echo "Run bootstrap-zitadel.sh first" >&2
    exit 1
fi

# Load state
# shellcheck source=/dev/null
source "$STATE_FILE"

# Required vars from state file
: "${ZITADEL_BACKEND_CLIENT_ID:?Missing ZITADEL_BACKEND_CLIENT_ID in state file}"
: "${ZITADEL_BACKEND_CLIENT_SECRET:?Missing ZITADEL_BACKEND_CLIENT_SECRET in state file}"
: "${ZITADEL_FRONTEND_CLIENT_ID:?Missing ZITADEL_FRONTEND_CLIENT_ID in state file}"
: "${ZITADEL_PROJECT_ID:?Missing ZITADEL_PROJECT_ID in state file}"
: "${ZITADEL_ISSUER_URL:?Missing ZITADEL_ISSUER_URL in state file}"

echo "=== Generating Zitadel OIDC config (target: $TARGET) ==="

# --- Docker target: env file for compose ---
if [ "$TARGET" = "docker" ]; then
    # Per-client: write to client state directory
    if [ -n "$CLIENT_ID" ]; then
        OUTPUT_FILE="$DEPLOY_DIR/state/clients/${CLIENT_ID}/fm-oidc.env"
    else
        OUTPUT_FILE="$DEPLOY_DIR/state/fm-oidc.env"
    fi

    FM_HOSTNAME="${FM_HOSTNAME:-localhost}"
    ZITADEL_EXTERNAL_PORT="${ZITADEL_EXTERNALPORT:-9090}"
    FM_PORT="${FLEET_MANAGER_PORT:-7011}"

    # Detect SSL mode from ZITADEL_EXTERNALSECURE (set by deploy scripts)
    scheme="http"
    if [ "${ZITADEL_EXTERNALSECURE:-false}" = "true" ]; then
        scheme="https"
    fi

    # Backend: Docker-internal URL (container-to-container, no port mapping needed)
    # The Docker-internal hostname is registered as a custom instance domain via
    # Zitadel's System API during bootstrap, so Zitadel accepts the Host header.
    BACKEND_AUTHORITY="http://zitadel:8080"
    # Frontend: external URL (browser-accessible, goes through published port)
    # Per-client: use CLIENT_DOMAIN if set (Traefik host-based routing)
    if [ -n "${CLIENT_DOMAIN:-}" ]; then
        REDIRECT_HOST="${CLIENT_DOMAIN}"
    else
        REDIRECT_HOST="${FM_HOSTNAME}"
    fi

    # Build frontend authority URL (omit default ports 80/443)
    if [ "$scheme" = "https" ] && [ "$ZITADEL_EXTERNAL_PORT" = "443" ]; then
        FRONTEND_AUTHORITY="${scheme}://${REDIRECT_HOST}"
    elif [ "$scheme" = "http" ] && [ "$ZITADEL_EXTERNAL_PORT" = "80" ]; then
        FRONTEND_AUTHORITY="${scheme}://${REDIRECT_HOST}"
    else
        FRONTEND_AUTHORITY="${scheme}://${REDIRECT_HOST}:${ZITADEL_EXTERNAL_PORT}"
    fi

    # Build redirect URI (when SSL, Traefik serves FM on 443 — no FM port needed)
    if [ "$scheme" = "https" ]; then
        REDIRECT_URI="${scheme}://${REDIRECT_HOST}/callback"
    else
        REDIRECT_URI="${scheme}://${REDIRECT_HOST}:${FM_PORT}/callback"
    fi

    cat > "$OUTPUT_FILE" <<EOF
# Auto-generated by generate-fm-config.sh — do not edit manually
# Backend OIDC (rc env var format for Fleet Manager)
fleet-manager_oidc__backend__authority=${BACKEND_AUTHORITY}
fleet-manager_oidc__backend__introspectionEndpoint=${BACKEND_AUTHORITY}/oauth/v2/introspect
fleet-manager_oidc__backend__authorization__type=basic
fleet-manager_oidc__backend__authorization__clientId=${ZITADEL_BACKEND_CLIENT_ID}
fleet-manager_oidc__backend__authorization__clientSecret=${ZITADEL_BACKEND_CLIENT_SECRET}
fleet-manager_oidc__backend__serviceToken=${ZITADEL_SERVICE_TOKEN:-}
# Frontend OIDC (consumed by entrypoint.sh → runtime-config.js)
OIDC_AUTHORITY=${FRONTEND_AUTHORITY}
OIDC_CLIENT_ID=${ZITADEL_FRONTEND_CLIENT_ID}
OIDC_PROJECT_ID=${ZITADEL_PROJECT_ID}
OIDC_REDIRECT_URI=${REDIRECT_URI}
EOF

    chmod 0600 "$OUTPUT_FILE"
    echo "  Generated: $OUTPUT_FILE"
    echo "  Backend authority:  $BACKEND_AUTHORITY"
    echo "  Frontend authority: $FRONTEND_AUTHORITY"

# --- Local target: .fleet-managerrc for running app outside Docker ---
elif [ "$TARGET" = "local" ]; then
    RC_FILE="$REPO_ROOT/.fleet-managerrc"

    FM_HOSTNAME="${FM_HOSTNAME:-localhost}"
    ZITADEL_EXTERNAL_PORT="${ZITADEL_EXTERNALPORT:-9090}"
    FM_PORT="${FLEET_MANAGER_PORT:-7011}"
    DB_PORT="${POSTGRES_PORT:-5434}"

    # Both backend and frontend use localhost (no Docker networking)
    AUTHORITY="http://${FM_HOSTNAME}:${ZITADEL_EXTERNAL_PORT}"

    cat > "$RC_FILE" <<RCEOF
{
  "oidc": {
    "backend": {
      "authority": "${AUTHORITY}",
      "introspectionEndpoint": "${AUTHORITY}/oauth/v2/introspect",
      "authorization": {
        "type": "basic",
        "clientId": "${ZITADEL_BACKEND_CLIENT_ID}",
        "clientSecret": "${ZITADEL_BACKEND_CLIENT_SECRET}"
      },
      "serviceToken": "${ZITADEL_SERVICE_TOKEN:-}"
    },
    "frontend": {
      "authority": "${AUTHORITY}",
      "client_id": "${ZITADEL_FRONTEND_CLIENT_ID}",
      "project_resource_id": "${ZITADEL_PROJECT_ID}",
      "redirect_uri": "http://${FM_HOSTNAME}:${FM_PORT}/callback",
      "response_type": "code",
      "scope": "openid profile email",
      "filterProtocolClaims": true,
      "loadUserInfo": true,
      "metadata": {
        "issuer": "${AUTHORITY}",
        "authorization_endpoint": "${AUTHORITY}/oauth/v2/authorize",
        "token_endpoint": "${AUTHORITY}/oauth/v2/token",
        "userinfo_endpoint": "${AUTHORITY}/oidc/v1/userinfo",
        "end_session_endpoint": "${AUTHORITY}/oidc/v1/end_session"
      }
    }
  },
  "internalStorage": {
    "connection": {
      "host": "localhost",
      "port": ${DB_PORT},
      "user": "postgres",
      "password": "${POSTGRES_PASSWORD:-fleet}",
      "database": "fleet",
      "max": 40
    },
    "schema": "migration",
    "cwd": [
      "./db/migration/postgresql/logging",
      "./db/migration/postgresql/organization",
      "./db/migration/postgresql/user",
      "./db/migration/postgresql/ui",
      "./db/migration/postgresql/device",
      "./db/migration/postgresql/device/groups",
      "./db/migration/postgresql/device/em",
      "./db/migration/postgresql/notifications"
    ],
    "link": {
      "schemas": ["device", "user", "ui", "organization", "device_em", "logging", "notifications"]
    }
  },
  "components": {
    "web": {
      "port": ${FM_PORT},
      "port_ssl": -1,
      "jwt_token": "dev-secret-token-change-in-production",
      "relativeClientPath": "../../../../frontend/dist"
    }
  },
  "logger": {
    "appenders": { "console": { "type": "console" } },
    "categories": { "default": { "appenders": ["console"], "level": "debug" } }
  }
}
RCEOF

    echo "  Generated: $RC_FILE"
    echo "  Authority: $AUTHORITY"
else
    echo "ERROR: Unknown target '$TARGET' (expected: docker or local)" >&2
    exit 1
fi
