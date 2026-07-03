# shellcheck shell=bash
# lib/preflight.sh — first-run guidance: pick local vs public, then check the
# machine can handle it before anything is installed or pulled. Warns in plain
# words; the deploy itself remains the hard gate.

# Interactive first run only: ask local-vs-domain so the user needn't know flags.
# Skips when flags already chose SSL, when non-interactive, or on a re-run.
preflight_choose_mode() {
    [ -t 0 ] || return 0
    [ "${WITH_SSL:-}" = "true" ] && return 0
    [ -n "${SSL_MODE:-}" ] && return 0
    [ -n "${SSL_DOMAIN:-}" ] && return 0
    [ -f "$STATE_DIR/.env" ] && return 0
    [ "${DEPLOY_ENV:-public}" = "public" ] || return 0

    echo ""
    echo "  ${BOLD}How will people reach Fleet Manager?${RESET}"
    echo "    ${CYAN}1${RESET}) Local network — self-signed certificate (default)"
    echo "    ${CYAN}2${RESET}) Public domain — free Let's Encrypt certificate"
    printf "  Choose [1-2, Enter for 1]: "
    local choice=""
    read -r choice || true

    if [ "$choice" = "2" ]; then
        _preflight_choose_domain
    else
        WITH_SSL=true
        SSL_MODE="selfsigned"
    fi
}

_preflight_choose_domain() {
    printf "  Domain (e.g. fleet.example.com): "
    local domain=""
    read -r domain || true
    if [ -z "$domain" ]; then
        warn "No domain entered — using local self-signed."
        WITH_SSL=true
        SSL_MODE="selfsigned"
        return 0
    fi
    printf "  Email for renewal reminders [admin@%s]: " "$domain"
    local email=""
    read -r email || true
    WITH_SSL=true
    SSL_MODE="letsencrypt"
    SSL_DOMAIN="$domain"
    SSL_EMAIL="${email:-admin@$domain}"
}

# Plain-language readiness check. Warns, never blocks.
preflight_check() {
    echo ""
    echo "  ${BOLD}Preflight${RESET}"
    _preflight_ram
    _preflight_disk
    _preflight_ports
    if [ ! -f "$STATE_DIR/.env" ]; then
        info "First run downloads ~2 GB of images and takes about 5-10 minutes."
    fi
}

_preflight_ram() {
    local kb=0
    if [ -r /proc/meminfo ]; then
        kb="$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null || echo 0)"
    elif command -v sysctl >/dev/null 2>&1; then
        local bytes
        bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
        kb=$((bytes / 1024))
    fi
    [ "${kb:-0}" -gt 0 ] || return 0
    local gb=$((kb / 1024 / 1024))
    if [ "$gb" -lt 4 ]; then
        warn "RAM: ${gb} GB — 4 GB is the recommended minimum."
    else
        ok "RAM: ${gb} GB"
    fi
}

_preflight_disk() {
    local avail_kb
    avail_kb="$(df -Pk . 2>/dev/null | awk 'NR==2{print $4}')"
    [ -n "${avail_kb:-}" ] || return 0
    local gb=$((avail_kb / 1024 / 1024))
    if [ "$gb" -lt 5 ]; then
        warn "Disk: ${gb} GB free here — images + data need about 5 GB."
    else
        ok "Disk: ${gb} GB free"
    fi
}

_preflight_ports() {
    local ports p
    if [ "${WITH_SSL:-}" = "true" ]; then
        ports="80 443"
    else
        ports="${FLEET_MANAGER_PORT:-7011} ${ZITADEL_EXTERNALPORT:-9090}"
    fi
    for p in $ports; do
        if check_port_available "$p"; then
            ok "Port $p free"
        else
            warn "Port $p in use — fine if an existing Fleet Manager owns it, otherwise free it."
        fi
    done
}

# After the deploy: confirm the UI answers and offer to open it (interactive only).
preflight_confirm_ui() {
    local url="${FM_ACCESS_URL:-}"
    [ -n "$url" ] || return 0
    if curl -fsS -k -o /dev/null --max-time 5 "$url" 2>/dev/null; then
        ok "Fleet Manager is reachable at ${url}"
    fi
    [ -t 0 ] || return 0
    command -v open >/dev/null 2>&1 || command -v xdg-open >/dev/null 2>&1 || return 0
    printf "  Open %s in your browser now? [Y/n]: " "$url"
    local answer=""
    read -r answer || true
    case "$answer" in
        n | N | no | NO) return 0 ;;
    esac
    if command -v open >/dev/null 2>&1; then
        open "$url" >/dev/null 2>&1 || true
    else
        xdg-open "$url" >/dev/null 2>&1 || true
    fi
}
