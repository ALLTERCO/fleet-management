#!/usr/bin/env bash

generate_zitadel_config() {
    local target="$1"
    local client_id="$2"
    local state_file
    local project_name_base="${ZITADEL_PROJECT_NAME:-fleet-manager}"

    if [ -n "$client_id" ]; then
        state_file="$DEPLOY_DIR/state/clients/${client_id}/zitadel.env"
    else
        state_file="$DEPLOY_DIR/state/zitadel.env"
    fi

    if [ ! -f "$state_file" ]; then
        echo "ERROR: State file not found: $state_file" >&2
        echo "Run bootstrap-zitadel.sh first" >&2
        exit 1
    fi

    unset ZITADEL_PROJECT_NAME
    # shellcheck source=/dev/null
    source "$state_file"

    : "${ZITADEL_CLIENT_BACKEND_CLIENT_ID:?Missing ZITADEL_CLIENT_BACKEND_CLIENT_ID in state file}"
    : "${ZITADEL_CLIENT_FRONTEND_CLIENT_ID:?Missing ZITADEL_CLIENT_FRONTEND_CLIENT_ID in state file}"
    : "${ZITADEL_CLIENT_PROJECT_ID:?Missing ZITADEL_CLIENT_PROJECT_ID in state file}"
    : "${FM_CLIENT_ORG_ID:?Missing FM_CLIENT_ORG_ID in state file}"
    : "${FM_PLATFORM_ORG_ID:?Missing FM_PLATFORM_ORG_ID in state file}"
    : "${ZITADEL_ISSUER_URL:?Missing ZITADEL_ISSUER_URL in state file}"
    if [ -z "${ZITADEL_PROJECT_NAME:-}" ]; then
        ZITADEL_PROJECT_NAME="$project_name_base"
        if [ -n "$client_id" ]; then
            ZITADEL_PROJECT_NAME="${ZITADEL_PROJECT_NAME}-${client_id}"
        fi
    fi

    ZITADEL_BACKEND_AUTH_METHOD="${ZITADEL_BACKEND_AUTH_METHOD:-basic}"
    if [ "$ZITADEL_BACKEND_AUTH_METHOD" = "basic" ]; then
        : "${ZITADEL_CLIENT_BACKEND_CLIENT_SECRET:?Missing ZITADEL_CLIENT_BACKEND_CLIENT_SECRET in state file}"
    fi

    echo "=== Generating Zitadel OIDC config (target: $target) ==="

    case "$target" in
        docker) generate_zitadel_docker_config "$client_id" ;;
        local) generate_zitadel_local_config ;;
        *)
            echo "ERROR: Unknown target '$target' (expected: docker or local)" >&2
            exit 1
            ;;
    esac
}

url_hostport() {
    local url="${1#*://}"
    printf '%s' "${url%%/*}"
}

oidc_backend_api_base_url_for_docker() {
    if [ -n "${ZITADEL_BACKEND_API_URL:-}" ]; then
        printf '%s' "$ZITADEL_BACKEND_API_URL"
        return
    fi

    local host="${ZITADEL_DOCKER_HOST:-zitadel-api}"
    local port="${ZITADEL_DOCKER_PORT:-8080}"

    printf 'http://%s:%s' "$host" "$port"
}

oidc_backend_issuer_for_docker() {
    local api_base_url="$1"
    local scheme="http"
    local hostport

    case "$ZITADEL_ISSUER_URL" in
        https://*) scheme="https" ;;
    esac
    hostport="$(url_hostport "$api_base_url")"

    printf '%s://%s' "$scheme" "$hostport"
}

oidc_authority_for_docker() {
    oidc_backend_issuer_for_docker "$1"
}

oidc_backend_auth_block() {
    if [ "$ZITADEL_BACKEND_AUTH_METHOD" = "jwt-profile" ]; then
        printf '%s\n' \
            "fleet-manager_oidc__backend__authorization__type=jwt-profile" \
            "fleet-manager_oidc__backend__authorization__clientId=${ZITADEL_CLIENT_BACKEND_CLIENT_ID}" \
            "FM_OIDC_AUTH_METHOD=jwt-profile" \
            "OIDC_INTROSPECTION_KEY_PATH=/app/state/secrets/oidc-introspection-key.json"
    else
        printf '%s\n' \
            "fleet-manager_oidc__backend__authorization__type=basic" \
            "fleet-manager_oidc__backend__authorization__clientId=${ZITADEL_CLIENT_BACKEND_CLIENT_ID}" \
            "fleet-manager_oidc__backend__authorization__clientSecret=${ZITADEL_CLIENT_BACKEND_CLIENT_SECRET}" \
            "FM_OIDC_AUTH_METHOD=basic"
    fi
}

oidc_service_auth_block() {
    local service_audience_url="$1"

    ZITADEL_SERVICE_AUTH_METHOD="${ZITADEL_SERVICE_AUTH_METHOD:-pat}"
    if [ "$ZITADEL_SERVICE_AUTH_METHOD" = "jwt-profile" ]; then
        printf '%s\n' \
            "FM_ZITADEL_SERVICE_AUTH=jwt-profile" \
            "ZITADEL_SERVICE_KEY_PATH=/app/state/secrets/zitadel-service-key.json" \
            "FM_ZITADEL_SERVICE_AUDIENCE_URL=${service_audience_url}" \
            "FM_ZITADEL_ISSUER_URL=${ZITADEL_ISSUER_URL}"
    else
        printf '%s' "FM_ZITADEL_SERVICE_AUTH=pat"
    fi
}

generate_zitadel_docker_config() {
    local client_id="$1"
    local output_file

    if [ -n "$client_id" ]; then
        output_file="$DEPLOY_DIR/state/clients/${client_id}/fm-runtime.env"
    else
        output_file="$DEPLOY_DIR/state/fm-runtime.env"
    fi

    local fm_hostname="${FM_HOSTNAME:-localhost}"
    local fm_port="${FLEET_MANAGER_PORT:-7011}"
    local scheme="http"
    [ "${ZITADEL_EXTERNALSECURE:-false}" = "true" ] && scheme="https"

    local redirect_host="${CLIENT_DOMAIN:-$fm_hostname}"
    local backend_authority backend_api_base_url frontend_authority redirect_uri backend_auth_block service_auth_block
    backend_api_base_url="$(oidc_backend_api_base_url_for_docker)"
    backend_authority="$(oidc_backend_issuer_for_docker "$backend_api_base_url")"
    frontend_authority="$ZITADEL_ISSUER_URL"

    if [ "$scheme" = "https" ]; then
        redirect_uri="${scheme}://${redirect_host}/callback"
    else
        redirect_uri="${scheme}://${redirect_host}:${fm_port}/callback"
    fi

    backend_auth_block="$(oidc_backend_auth_block)"
    service_auth_block="$(oidc_service_auth_block "$backend_authority")"

    local runtime_client_id runtime_topology_mode runtime_compose_project
    if [ -n "$client_id" ]; then
        runtime_client_id="$client_id"
        runtime_topology_mode="shared-client"
        runtime_compose_project="fm-${client_id}"
    else
        runtime_client_id="${FM_CLIENT_ID:-shared}"
        runtime_topology_mode="${FM_TOPOLOGY_MODE:-single-tenant}"
        runtime_compose_project="${COMPOSE_PROJECT_NAME:-${FM_COMPOSE_PROJECT_NAME:-unknown}}"
    fi

    cat > "$output_file" <<EOF
# Auto-generated by generate-fm-config.sh — do not edit manually
# Backend OIDC (rc env var format for Fleet Manager)
fleet-manager_oidc__backend__authority=${backend_authority}
fleet-manager_oidc__backend__apiBaseUrl=${backend_api_base_url}
fleet-manager_oidc__backend__introspectionEndpoint=${backend_api_base_url}/oauth/v2/introspect
fleet-manager_oidc__backend__userinfoEndpoint=${backend_api_base_url}/oidc/v1/userinfo
${backend_auth_block}
fleet-manager_oidc__backend__serviceToken=${ZITADEL_SERVICE_TOKEN:-}
${service_auth_block}
FM_PLATFORM_ORG_ID=${FM_PLATFORM_ORG_ID}
FM_PLATFORM_ORG_NAME=${FM_PLATFORM_ORG_NAME:-}
FM_PLATFORM_ADMIN_ROLE=${FM_PLATFORM_ADMIN_ROLE:-IAM_OWNER}
FM_CLIENT_ORG_ID=${FM_CLIENT_ORG_ID}
FM_CLIENT_ORG_NAME=${FM_CLIENT_ORG_NAME:-}
ZITADEL_CLIENT_PROJECT_ID=${ZITADEL_CLIENT_PROJECT_ID}
ZITADEL_PROJECT_NAME=${ZITADEL_PROJECT_NAME}
FM_NODE_RED_SERVICE_TOKEN=${FM_NODE_RED_SERVICE_TOKEN:-}
FM_NODE_RED_SERVICE_USER_ID=${FM_NODE_RED_SERVICE_USER_ID:-}
FM_NODE_RED_ORG_ID=${FM_NODE_RED_ORG_ID:-${FM_CLIENT_ORG_ID:-}}
FM_NODE_RED_PERMISSIONS=${FM_NODE_RED_PERMISSIONS:-device:read,device:execute,action:execute}
FM_NODE_RED_PROXY_SECRET=${FM_NODE_RED_PROXY_SECRET:-}
FM_NODE_RED_CREDENTIAL_SECRET=${FM_NODE_RED_CREDENTIAL_SECRET:-}
FM_GRAFANA_SERVICE_TOKEN=${FM_GRAFANA_SERVICE_TOKEN:-}
FM_GRAFANA_SERVICE_USER_ID=${FM_GRAFANA_SERVICE_USER_ID:-}
FM_GRAFANA_ORG_ID=${FM_GRAFANA_ORG_ID:-${FM_CLIENT_ORG_ID:-}}
FM_GRAFANA_PERMISSIONS=${FM_GRAFANA_PERMISSIONS:-grafana:read}
FM_GRAFANA_PROXY_SECRET=${FM_GRAFANA_PROXY_SECRET:-}
FM_CLIENT_ID=${runtime_client_id}
FM_ENVIRONMENT_ID=${FM_ENVIRONMENT_ID:-${ENV_NAME:-unknown}}
FM_TOPOLOGY_MODE=${runtime_topology_mode}
FM_COMPOSE_PROJECT_NAME=${runtime_compose_project}
FM_MANAGED_BY=${FM_MANAGED_BY:-fleet-manager}
# HMAC keys Zitadel signs Action V2 webhook deliveries with.
# *_PREVIOUS slots stay populated for one rotation to bridge the overlap window.
FM_ZITADEL_GDPR_SIGNING_KEY=${FM_ZITADEL_GDPR_SIGNING_KEY:-}
FM_ZITADEL_GDPR_SIGNING_KEY_PREVIOUS=${FM_ZITADEL_GDPR_SIGNING_KEY_PREVIOUS:-}
FM_ZITADEL_GRANT_SIGNING_KEY=${FM_ZITADEL_GRANT_SIGNING_KEY:-}
FM_ZITADEL_GRANT_SIGNING_KEY_PREVIOUS=${FM_ZITADEL_GRANT_SIGNING_KEY_PREVIOUS:-}
# Frontend OIDC (consumed by entrypoint.sh → runtime-config.js)
OIDC_AUTHORITY=${frontend_authority}
OIDC_CLIENT_ID=${ZITADEL_CLIENT_FRONTEND_CLIENT_ID}
OIDC_PROJECT_ID=${ZITADEL_CLIENT_PROJECT_ID}
OIDC_REDIRECT_URI=${redirect_uri}
EOF

    chmod 0600 "$output_file"
    echo "  Generated: $output_file"
    echo "  Backend authority:  $backend_authority"
    echo "  Backend API:        $backend_api_base_url"
    echo "  Frontend authority: $frontend_authority"
}

generate_zitadel_local_config() {
    local rc_file="$REPO_ROOT/.fleet-managerrc"
    local fm_hostname="${FM_HOSTNAME:-localhost}"
    local zitadel_external_port="${ZITADEL_EXTERNALPORT:-9090}"
    local fm_port="${FLEET_MANAGER_PORT:-7011}"
    local db_port="${POSTGRES_PORT:-5434}"
    local authority="http://${fm_hostname}:${zitadel_external_port}"

    cat > "$rc_file" <<RCEOF
{
    "oidc": {
    "backend": {
      "authority": "${authority}",
      "introspectionEndpoint": "${authority}/oauth/v2/introspect",
      "authorization": {
        "type": "basic",
        "clientId": "${ZITADEL_CLIENT_BACKEND_CLIENT_ID}",
        "clientSecret": "${ZITADEL_CLIENT_BACKEND_CLIENT_SECRET}"
      },
      "serviceToken": "${ZITADEL_SERVICE_TOKEN:-}"
    },
    "frontend": {
      "authority": "${authority}",
      "client_id": "${ZITADEL_CLIENT_FRONTEND_CLIENT_ID}",
      "project_resource_id": "${ZITADEL_CLIENT_PROJECT_ID}",
      "redirect_uri": "http://${fm_hostname}:${fm_port}/callback",
      "response_type": "code",
      "scope": "${FM_OIDC_SCOPE:?FM_OIDC_SCOPE must be set in env}",
      "filterProtocolClaims": true,
      "loadUserInfo": true,
      "metadata": {
        "issuer": "${authority}",
        "authorization_endpoint": "${authority}/oauth/v2/authorize",
        "token_endpoint": "${authority}/oauth/v2/token",
        "userinfo_endpoint": "${authority}/oidc/v1/userinfo",
        "end_session_endpoint": "${authority}/oidc/v1/end_session"
      }
    }
  },
  "serviceAccounts": {
    "nodered": {
      "userId": "${FM_NODE_RED_SERVICE_USER_ID:-}",
      "token": "${FM_NODE_RED_SERVICE_TOKEN:-}"
    },
    "grafana": {
      "userId": "${FM_GRAFANA_SERVICE_USER_ID:-}",
      "token": "${FM_GRAFANA_SERVICE_TOKEN:-}"
    }
  },
  "internalStorage": {
    "connection": {
      "host": "localhost",
      "port": ${db_port},
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
      "port": ${fm_port},
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

    echo "  Generated: $rc_file"
    echo "  Authority: $authority"
}
