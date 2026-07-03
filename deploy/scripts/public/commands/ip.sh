# shellcheck shell=bash

# Shared printer for the Zitadel JWT key paths. Both `up` summary and the
# standalone `ip` command call this so users always see the keys when active.
print_jwt_keys_block() {
    local sep="${1:-${DIM}──────────────────────────────────────────────${RESET}}"
    [ "${FM_OIDC_AUTH_METHOD:-basic}" = "jwt-profile" ] || \
        [ "${FM_ZITADEL_SERVICE_AUTH:-pat}" = "jwt-profile" ] || return 0
    echo ""
    echo "${sep}"
    echo "  ${BOLD}Zitadel JWT keys (back these up)${RESET}"
    if [ "${FM_OIDC_AUTH_METHOD:-basic}" = "jwt-profile" ] && \
       [ -f "$STATE_DIR/secrets/oidc-introspection-key.json" ]; then
        echo "  ${DIM}Introspection:${RESET} ${CYAN}${STATE_DIR}/secrets/oidc-introspection-key.json${RESET}"
    fi
    if [ "${FM_ZITADEL_SERVICE_AUTH:-pat}" = "jwt-profile" ] && \
       [ -f "$STATE_DIR/secrets/zitadel-service-key.json" ]; then
        echo "  ${DIM}Service user:${RESET}  ${CYAN}${STATE_DIR}/secrets/zitadel-service-key.json${RESET}"
    fi
    echo "  ${DIM}Lose them = re-bootstrap Zitadel. Mounted read-only at /app/state/secrets/.${RESET}"
}

# Pointer at the credentials file written on first install.
print_initial_credentials_block() {
    local sep="${1:-${DIM}──────────────────────────────────────────────${RESET}}"
    local creds_file="$STATE_DIR/initial-credentials.txt"
    [ -f "$creds_file" ] || return 0
    echo ""
    echo "${sep}"
    echo "  ${BOLD}Auto-generated credentials${RESET}"
    echo "  ${DIM}Saved to:${RESET}  ${CYAN}${creds_file}${RESET}  ${DIM}(chmod 0600)${RESET}"
    echo "  ${DIM}View:${RESET}      ${CYAN}cat ${creds_file}${RESET}"
    echo "  ${DIM}Rotate:${RESET}    ${CYAN}./deploy/deploy-public.sh rotate-secrets${RESET}"
}

cmd_ip() {
    enable_debug_mode
    detect_os
    load_deploy_meta
    local ip
    ip=$(detect_ip)

    echo ""
    echo "${BOLD}Platform:${RESET}   ${OS}/${ARCH}${DISTRO:+ ($DISTRO)}"
    echo "${BOLD}Machine IP:${RESET} $ip"
    echo ""
    echo "${BOLD}Access URLs:${RESET}"
    if [ "$WITH_SSL" = "true" ]; then
        local hostname="${SSL_DOMAIN:-${DEPLOY_HOSTNAME:-$ip}}"
        echo "  Fleet Manager:   ${CYAN}https://${hostname}${RESET}"
        [ "$FM_DEV_MODE" != "true" ] && \
            echo "  Zitadel Console: ${CYAN}https://${hostname}/ui/console${RESET}"
        echo ""
        echo "${BOLD}Device WebSocket:${RESET}"
        echo "  wss://${hostname}/shelly"
    else
        echo "  Fleet Manager:   ${CYAN}http://${ip}:${FLEET_MANAGER_PORT}${RESET}"
        [ "$FM_DEV_MODE" != "true" ] && \
            echo "  Zitadel Console: ${CYAN}http://${ip}:${ZITADEL_EXTERNALPORT}/ui/console${RESET}"
        echo ""
        echo "${BOLD}Device WebSocket:${RESET}"
        echo "  ws://${ip}:${FLEET_MANAGER_PORT}/shelly"
    fi
    print_jwt_keys_block ""
    echo ""
}

# ── Summary ───────────────────────────────────────────────────
print_summary() {
    local hostname="$1"
    local scheme="http"
    local ws_scheme="ws"
    local fm_url zitadel_url ws_url

    if [ "$WITH_SSL" = "true" ]; then
        scheme="https"
        ws_scheme="wss"
        fm_url="${scheme}://${hostname}"
        zitadel_url="${scheme}://${hostname}/ui/console"
        ws_url="${ws_scheme}://${hostname}/shelly"
    else
        fm_url="${scheme}://${hostname}:${FLEET_MANAGER_PORT}"
        zitadel_url="${scheme}://${hostname}:${ZITADEL_EXTERNALPORT}/ui/console"
        ws_url="${ws_scheme}://${hostname}:${FLEET_MANAGER_PORT}/shelly"
    fi
    # Single source for the access URL — preflight_confirm_ui reuses it.
    export FM_ACCESS_URL="$fm_url"

    local SEP="${DIM}──────────────────────────────────────────────${RESET}"

    echo ""
    echo "${BOLD}${GREEN}  ✔  Fleet Management is running${RESET}"
    echo "${SEP}"
    echo ""
    echo "  ${DIM}Platform${RESET}         ${OS:-unknown}/${ARCH:-unknown}${DISTRO:+ ($DISTRO)}"
    echo "  ${DIM}Fleet Manager${RESET}    ${CYAN}${fm_url}${RESET}"
    if [ "$FM_DEV_MODE" != "true" ]; then
        echo "  ${DIM}Zitadel Console${RESET}  ${CYAN}${zitadel_url}${RESET}"
    fi
    if [ "$WITH_LOGGING" = "true" ]; then
        echo "  ${DIM}Log Viewer${RESET}       ${CYAN}http://${hostname}:${DOZZLE_PORT:-9999}${RESET}"
    fi
    echo ""
    echo "${SEP}"
    echo "  ${BOLD}Login${RESET}"
    local zitadel_state_file="$STATE_DIR/zitadel.env"
    if [ "$FM_DEV_MODE" != "true" ] && [ -f "$zitadel_state_file" ]; then
        # shellcheck source=/dev/null
        source "$zitadel_state_file"
    fi
    if [ "$FM_DEV_MODE" = "true" ]; then
        echo "  ${YELLOW}DEV MODE — seeded admin user, no OIDC${RESET}"
        echo "  ${DIM}Username${RESET}  $(cv_id admin)"
        echo "  ${DIM}Password${RESET}  $(cv_cred admin)"
        echo "  ${DIM}Use only on localhost / trusted networks.${RESET}"
    else
        local zitadel_domain="${ZITADEL_HOSTNAME:-$hostname}"
        echo "  ${DIM}FM Admin${RESET}       $(cv_id "${FM_ADMIN_USER}@${zitadel_domain}") / $(cv_cred "${FM_ADMIN_PASSWORD}")"
        if [ -n "${FM_PLATFORM_ADMIN_USER:-}" ] || [ -n "${FM_PLATFORM_ADMIN_PASSWORD:-}" ]; then
            echo "  ${DIM}Platform Admin${RESET} $(cv_id "${FM_PLATFORM_ADMIN_USER:-fm-platform-admin}@${zitadel_domain}") / $(cv_cred "${FM_PLATFORM_ADMIN_PASSWORD:-unknown}")"
        fi
        echo "  ${DIM}Zitadel Root${RESET}   $(cv_id "root@${zitadel_domain}") / $(cv_cred "${ZITADEL_ADMIN_PASSWORD:-unknown}")"
    fi
    if [ "$SSL_MODE" = "selfsigned" ] && [ -f "$STATE_DIR/tls/ca.crt" ]; then
        echo ""
        echo "${SEP}"
        echo "  ${BOLD}Trust the CA cert (one-time)${RESET}"
        echo "  ${CYAN}${STATE_DIR}/tls/ca.crt${RESET}"
        echo "  ${DIM}macOS:${RESET}  open the file, add to System keychain, mark Always Trust"
        echo "  ${DIM}Linux:${RESET}  copy to /usr/local/share/ca-certificates/ && update-ca-certificates"
        echo "  ${DIM}Win:${RESET}    import to Trusted Root Certification Authorities"
    fi
    print_jwt_keys_block "$SEP"
    print_initial_credentials_block "$SEP"
    echo ""
    echo "${SEP}"
    echo "  ${BOLD}Connect a Shelly device${RESET}"
    echo "  ${DIM}WebSocket${RESET}  ${CYAN}${ws_url}${RESET}"
    if [ "$SSL_MODE" = "selfsigned" ]; then
        echo ""
        echo "  ${YELLOW}Self-signed TLS — configure each device:${RESET}"
        echo "  ${DIM}1.${RESET} Upload CA        Settings > TLS Configuration > Custom CA PEM bundle"
        echo "                      File: ${CYAN}${STATE_DIR}/tls/ca.crt${RESET}"
        echo "  ${DIM}2.${RESET} Connection type  Outbound WebSocket > ${CYAN}User TLS${RESET}"
        echo "  ${DIM}3.${RESET} Server           ${CYAN}${ws_url}${RESET}"
    fi
    echo ""
    echo "${SEP}"
    echo "  ${BOLD}Data retention${RESET}"
    echo "  ${DIM}Telemetry${RESET}   $(cv_dim "${STATUS_RETENTION:-7 days}")"
    echo "  ${DIM}Energy${RESET}      $(cv_dim "${EM_STATS_RETENTION:-1 year}")"
    echo "  ${DIM}Audit logs${RESET}  $(cv_dim "${AUDIT_LOG_RETENTION:-90 days}")"
    echo ""
    echo "${SEP}"
    echo "  ${BOLD}Commands${RESET}"
    echo "  ${CYAN}./deploy/deploy-public.sh status${RESET}    Service health"
    echo "  ${CYAN}./deploy/deploy-public.sh logs${RESET}      Follow logs"
    echo "  ${CYAN}./deploy/deploy-public.sh down${RESET}      Stop services"
    echo "  ${CYAN}./deploy/deploy-public.sh upgrade${RESET}   Pull newer images & restart"
    echo ""
}

# ── Doctor ─────────────────────────────────────────────────────
