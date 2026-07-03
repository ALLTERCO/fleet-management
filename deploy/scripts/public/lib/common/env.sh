# shellcheck shell=bash
# common/env.sh — public deploy paths and default environment.
# shellcheck disable=SC2034 # Shared globals are consumed after this file is sourced.

FM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
DEPLOY_DIR="$FM_DIR/deploy"
STATE_DIR="$DEPLOY_DIR/state"
DEPLOY_META_FILE="$STATE_DIR/deploy-meta.env"
COMPOSE_DIR="$DEPLOY_DIR/compose"
VERSIONS_FILE="$DEPLOY_DIR/VERSIONS.env"

DOCKER_HUB_IMAGE="shellygroup/fleet-management"

PUBLIC_ENV_FILE="$DEPLOY_DIR/env/public.env"
if [ -f "$PUBLIC_ENV_FILE" ]; then
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | sed -E 's/[[:space:]]+#.*$//' | xargs)
        if [ -z "${!key:-}" ]; then
            export "$key=$value"
        fi
    done < "$PUBLIC_ENV_FILE"
fi

: "${FM_VERSION:=latest}"
: "${FLEET_MANAGER_PORT:=7011}"
: "${ZITADEL_EXTERNALPORT:=9090}"
: "${COMPOSE_PROJECT_NAME:=fm}"
: "${FM_TOPOLOGY_MODE:=single-tenant}"
: "${FM_MANAGED_BY:=fleet-manager}"
FM_COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${FM_COMPOSE_PROJECT_NAME:-fm}}"

WITH_MDNS="${WITH_MDNS:-false}"
WITH_SSL="${WITH_SSL:-false}"
SSL_MODE="${SSL_MODE:-}"
SSL_DOMAIN="${SSL_DOMAIN:-}"
SSL_EMAIL="${SSL_EMAIL:-}"
SSL_CERT_FILE="${SSL_CERT_FILE:-}"
SSL_KEY_FILE="${SSL_KEY_FILE:-}"
WITH_LOGGING="${WITH_LOGGING:-false}"
# Single source for dev/local-auth mode. Set by dev.env, read by FM, entrypoint, and this script.
FM_DEV_MODE="${FM_DEV_MODE:-false}"

# Deploy env selector — picks deploy/env/<name>.env. Default = public.
# dev = local auth (FM_DEV_MODE=true in dev.env), no Zitadel.
# local = full Docker stack with Zitadel. cloud-test = CI public-path test.
# public = community installer default.
DEPLOY_ENV="${DEPLOY_ENV:-public}"
FM_ENVIRONMENT_ID="${DEPLOY_ENV:-${FM_ENVIRONMENT_ID:-public}}"
export FM_TOPOLOGY_MODE FM_ENVIRONMENT_ID FM_COMPOSE_PROJECT_NAME FM_MANAGED_BY

# Load env file overrides for the chosen deploy env (skip public — already
# loaded as defaults above). Caller (args parser) sets DEPLOY_ENV first.
load_deploy_env_overrides() {
    if [ "$DEPLOY_ENV" = "public" ]; then return 0; fi
    local env_file="$DEPLOY_DIR/env/${DEPLOY_ENV}.env"
    if [ ! -f "$env_file" ]; then
        echo "[error] env file not found: $env_file" >&2
        return 1
    fi
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | sed -E 's/[[:space:]]+#.*$//' | xargs)
        export "$key=$value"
    done < "$env_file"
    FM_ENVIRONMENT_ID="${DEPLOY_ENV:-${FM_ENVIRONMENT_ID:-unknown}}"
    FM_COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${FM_COMPOSE_PROJECT_NAME:-fm}}"
    FM_TOPOLOGY_MODE="${FM_TOPOLOGY_MODE:-single-tenant}"
    FM_MANAGED_BY="${FM_MANAGED_BY:-fleet-manager}"
    export FM_TOPOLOGY_MODE FM_ENVIRONMENT_ID FM_COMPOSE_PROJECT_NAME FM_MANAGED_BY
}
