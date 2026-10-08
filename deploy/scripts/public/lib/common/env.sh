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

# Capture operator/CI exports before tracked defaults are loaded. Environment
# variables are the highest-precedence public-deploy input, including masked
# provider credentials used by cloud-test.
FM_OPERATOR_ENV_KEYS="$(compgen -e)"

# Exports each KEY=value of a tracked defaults file that is not already set.
_public_load_env_defaults() {
    local file="$1" key value
    [ -f "$file" ] || return 0
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | sed -E 's/[[:space:]]+#.*$//' | xargs)
        if [ -z "${!key:-}" ]; then
            export "$key=$value"
        fi
    done < "$file"
}

PUBLIC_ENV_FILE="$DEPLOY_DIR/env/public.env"
_public_load_env_defaults "$PUBLIC_ENV_FILE"
# Compose reads the pins from VERSIONS.env; the installer's own checks (the
# migrate plan, the PostgreSQL major guard) must see the same targets.
_public_load_env_defaults "$VERSIONS_FILE"

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
# Empty = not chosen this run; resolve_nodered_choice falls back to the saved choice.
WITH_NODERED="${WITH_NODERED:-}"
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
    # The public release ships no dev.env; point the host-run backend at the
    # ports docker-compose.dev-ports.yml publishes.
    if [ "$DEPLOY_ENV" = "dev" ] && [ ! -f "$env_file" ]; then
        export FM_DEV_MODE=true
        export POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
        export POSTGRES_PORT="${POSTGRES_PORT:-5434}"
        export POSTGRES_USER="${POSTGRES_USER:-postgres}"
        export POSTGRES_DB="${POSTGRES_DB:-fleet}"
        export FM_REDIS_URL="${FM_REDIS_URL:-redis://localhost:${REDIS_PORT:-6379}}"
        FM_ENVIRONMENT_ID="dev"
        FM_COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${FM_COMPOSE_PROJECT_NAME:-fm}}"
        FM_TOPOLOGY_MODE="${FM_TOPOLOGY_MODE:-single-tenant}"
        return 0
    fi
    if [ ! -f "$env_file" ]; then
        echo "[error] env file not found: $env_file" >&2
        return 1
    fi
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | sed -E 's/[[:space:]]+#.*$//' | xargs)
        if grep -Fqx -- "$key" <<<"$FM_OPERATOR_ENV_KEYS"; then
            continue
        fi
        export "$key=$value"
    done < "$env_file"
    FM_ENVIRONMENT_ID="${DEPLOY_ENV:-${FM_ENVIRONMENT_ID:-unknown}}"
    FM_COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${FM_COMPOSE_PROJECT_NAME:-fm}}"
    FM_TOPOLOGY_MODE="${FM_TOPOLOGY_MODE:-single-tenant}"
    FM_MANAGED_BY="${FM_MANAGED_BY:-fleet-manager}"
    export FM_TOPOLOGY_MODE FM_ENVIRONMENT_ID FM_COMPOSE_PROJECT_NAME FM_MANAGED_BY
}
