# shellcheck shell=bash
# Shared secret generation + validation. Sourced by both deploy flows.

DEMO_LITERAL_REGEX='fleet-public-demo|DevDemo|PublicDemo|FleetDemo|CHANGEME_'

# Random hex without pipelines, so it is safe under `set -o pipefail`.
_random_passwd() {
    local bytes="${1:-24}"
    local raw
    raw="$(openssl rand -hex "$bytes")" || return 1
    printf '%s' "${raw:0:$bytes}"
}

# Zitadel needs upper+lower+digit+symbol >=12; A1! suffix guarantees it.
_random_zitadel_admin() {
    printf '%s' "$(_random_passwd 20)A1!"
}

# `:=` only fires when var is unset OR empty — operator overrides win.
generate_passwords() {
    : "${POSTGRES_PASSWORD:=$(_random_passwd 24)}"
    : "${ZITADEL_POSTGRES_PASSWORD:=$POSTGRES_PASSWORD}"
    : "${ZITADEL_DB_USER_PASSWORD:=$POSTGRES_PASSWORD}"
    : "${ZITADEL_ADMIN_PASSWORD:=$(_random_zitadel_admin)}"
    : "${ZITADEL_MASTERKEY:=$(_random_passwd 32)}"
    : "${FM_SECRET_ENCRYPTION_KEY:=$(_random_passwd 64)}"
    : "${FM_SECRET_KDF_SALT:=$(_random_passwd 32)}"
    : "${FM_DEVICE_INGRESS_TOKEN_PEPPER:=$(_random_passwd 64)}"
    : "${FM_NOTIFICATION_RECEIPT_SIGNING_SECRET:=$(_random_passwd 64)}"
    : "${JWT_SECRET:=$(_random_passwd 64)}"
    : "${FM_GRAFANA_DB_PASSWORD:=$(_random_passwd 32)}"
    : "${REDIS_ADMIN_PASSWORD:=$(_random_passwd 32)}"
    : "${REDIS_FM_PASSWORD:=$(_random_passwd 32)}"
    : "${REDIS_ZITADEL_PASSWORD:=$(_random_passwd 32)}"
    : "${FM_ADMIN_PASSWORD:=$(_random_zitadel_admin)}"
    : "${FM_PLATFORM_ADMIN_PASSWORD:=$(_random_zitadel_admin)}"

    export POSTGRES_PASSWORD ZITADEL_POSTGRES_PASSWORD ZITADEL_DB_USER_PASSWORD
    export ZITADEL_ADMIN_PASSWORD ZITADEL_MASTERKEY
    export FM_SECRET_ENCRYPTION_KEY FM_SECRET_KDF_SALT
    export FM_DEVICE_INGRESS_TOKEN_PEPPER FM_NOTIFICATION_RECEIPT_SIGNING_SECRET
    export JWT_SECRET
    export FM_GRAFANA_DB_PASSWORD
    export REDIS_ADMIN_PASSWORD REDIS_FM_PASSWORD REDIS_ZITADEL_PASSWORD
    export FM_ADMIN_PASSWORD FM_PLATFORM_ADMIN_PASSWORD
}

migrate_legacy_secret_encryption_key() {
    local explicit_legacy_key="${1:-}"
    local legacy_key="${explicit_legacy_key:-${JWT_SECRET:-}}"
    if [ -z "$legacy_key" ]; then
        return 0
    fi
    if [ -z "$explicit_legacy_key" ] && [ -n "${FM_SECRET_ENCRYPTION_KEY:-}" ]; then
        return 0
    fi
    if [ -n "${FM_SECRET_ENCRYPTION_KEY_PREVIOUS:-}" ] && \
       [ "$FM_SECRET_ENCRYPTION_KEY_PREVIOUS" != "$legacy_key" ]; then
        _secrets_error "cannot preserve legacy JWT encryption key: previous-key slot is already occupied"
        return 1
    fi

    local legacy_key_id="${2:-${FM_SECRET_ENCRYPTION_KEY_ID:-primary}}"
    FM_SECRET_ENCRYPTION_KEY_PREVIOUS="$legacy_key"
    FM_SECRET_ENCRYPTION_KEY_PREVIOUS_ID="$legacy_key_id"
    if [ -z "${FM_SECRET_ENCRYPTION_KEY:-}" ] || \
       [ "$FM_SECRET_ENCRYPTION_KEY" = "$legacy_key" ]; then
        FM_SECRET_ENCRYPTION_KEY="$(_random_passwd 64)" || return 1
    fi
    if [ -z "${FM_SECRET_ENCRYPTION_KEY_ID:-}" ] || \
       [ "$FM_SECRET_ENCRYPTION_KEY_ID" = "$legacy_key_id" ]; then
        FM_SECRET_ENCRYPTION_KEY_ID="migrated-$(_random_passwd 12)" || return 1
    fi
    export FM_SECRET_ENCRYPTION_KEY FM_SECRET_ENCRYPTION_KEY_ID
    export FM_SECRET_ENCRYPTION_KEY_PREVIOUS
    export FM_SECRET_ENCRYPTION_KEY_PREVIOUS_ID
}

# 0 = clean. Non-zero = count of vars holding demo / placeholder literals.
validate_no_demo_literals() {
    local var bad=0
    for var in POSTGRES_PASSWORD ZITADEL_POSTGRES_PASSWORD \
        ZITADEL_DB_USER_PASSWORD ZITADEL_ADMIN_PASSWORD ZITADEL_MASTERKEY \
        FM_SECRET_ENCRYPTION_KEY FM_SECRET_KDF_SALT \
        FM_DEVICE_INGRESS_TOKEN_PEPPER FM_NOTIFICATION_RECEIPT_SIGNING_SECRET \
        JWT_SECRET; do
        local val="${!var:-}"
        if [ -z "$val" ]; then
            _secrets_error "$var is empty — refusing to start"
            bad=$((bad + 1))
            continue
        fi
        if echo "$val" | grep -Eq "$DEMO_LITERAL_REGEX"; then
            _secrets_error "$var holds a known demo literal — rotate before deploy"
            bad=$((bad + 1))
        fi
    done
    return $bad
}

validate_bootstrap_admin_passwords() {
    local env_name="${1:-}" var val bad=0

    case "$env_name" in
        prod|staging|public) ;;
        *) return 0 ;;
    esac

    for var in FM_ADMIN_PASSWORD FM_PLATFORM_ADMIN_PASSWORD; do
        val="${!var:-}"
        if [ -z "$val" ]; then
            _secrets_error "$var is empty — refusing production-like deploy"
            bad=$((bad + 1))
            continue
        fi
        if _is_demo_admin_password "$val"; then
            _secrets_error "$var holds a demo / placeholder password — rotate before deploy"
            bad=$((bad + 1))
            continue
        fi
        if [ "${#val}" -lt 12 ]; then
            _secrets_error "$var must be at least 12 characters for production-like deploys"
            bad=$((bad + 1))
        fi
    done

    return $bad
}

_is_demo_admin_password() {
    local value="$1"
    case "$value" in
        Admin123!|Admin1234!|admin|password|Password123!|CHANGEME*) return 0 ;;
    esac
    echo "$value" | grep -Eq "$DEMO_LITERAL_REGEX"
}

# Public flow defines error(); private flow defines log_error().
_secrets_error() {
    if declare -F error >/dev/null 2>&1; then
        error "$*"
    elif declare -F log_error >/dev/null 2>&1; then
        log_error "$*"
    else
        echo "[ERROR] $*" >&2
    fi
}
