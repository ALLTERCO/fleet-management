# shellcheck shell=bash
# Shared Zitadel identity SMTP validation.

zitadel_identity_smtp_enabled() {
    [ -n "${ZITADEL_SMTP_HOST:-}" ] || \
        [ -n "${ZITADEL_SMTP_FROM:-}" ] || \
        [ -n "${ZITADEL_SMTP_USER:-}" ] || \
        [ -n "${ZITADEL_SMTP_PASSWORD:-}" ]
}

validate_zitadel_identity_smtp() {
    zitadel_identity_smtp_enabled || return 0

    local bad=0
    if [ -z "${ZITADEL_SMTP_HOST:-}" ]; then
        _zitadel_smtp_error "ZITADEL_SMTP_HOST is required when Zitadel identity SMTP is configured"
        bad=$((bad + 1))
    fi
    if [ -z "${ZITADEL_SMTP_FROM:-}" ]; then
        _zitadel_smtp_error "ZITADEL_SMTP_FROM is required when Zitadel identity SMTP is configured"
        bad=$((bad + 1))
    fi
    if [ -n "${ZITADEL_SMTP_USER:-}" ] && [ -z "${ZITADEL_SMTP_PASSWORD:-}" ]; then
        _zitadel_smtp_error "ZITADEL_SMTP_PASSWORD is required when ZITADEL_SMTP_USER is set"
        bad=$((bad + 1))
    fi
    if [ -z "${ZITADEL_SMTP_USER:-}" ] && [ -n "${ZITADEL_SMTP_PASSWORD:-}" ]; then
        _zitadel_smtp_error "ZITADEL_SMTP_USER is required when ZITADEL_SMTP_PASSWORD is set"
        bad=$((bad + 1))
    fi
    if [ "${ZITADEL_SMTP_PASSWORD:-}" = "NotArealPAss" ]; then
        _zitadel_smtp_error "ZITADEL_SMTP_PASSWORD contains a known fake placeholder"
        bad=$((bad + 1))
    fi
    return "$bad"
}

_zitadel_smtp_error() {
    if declare -F error >/dev/null 2>&1; then
        error "$*"
    elif declare -F log_error >/dev/null 2>&1; then
        log_error "$*"
    else
        echo "[ERROR] $*" >&2
    fi
}
