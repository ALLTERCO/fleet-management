# shellcheck shell=bash
# lib/zitadel.sh — Zitadel bootstrap, OIDC config generation

# shellcheck source=deploy/scripts/common/zitadel-lib.sh
source "$DEPLOY_DIR/scripts/common/zitadel-lib.sh"

wait_for_zitadel() {
    local url="$1"
    local timeout="${2:-180}"
    local elapsed=0

    spinner_start "Waiting for Zitadel... (up to ${timeout}s)"
    while [ $elapsed -lt "$timeout" ]; do
        if curl -sf --connect-timeout 10 --max-time 10 "${url}/debug/ready" >/dev/null 2>&1; then
            spinner_stop ok "Zitadel ready (${elapsed}s)"
            return 0
        fi
        sleep 3
        elapsed=$((elapsed + 3))
        spinner_update "Waiting for Zitadel... (${elapsed}s)"
    done

    spinner_stop fail "Zitadel did not start within ${timeout}s"
    hc_dump_diagnostics zitadel 100
    return 1
}

run_bootstrap() {
    local hostname="$1"

    step "Bootstrapping Zitadel (OIDC setup)"

    export ZITADEL_URL="http://localhost:8080"
    # Host header for NAT hairpin — strip default ports (443/HTTPS, 80/HTTP)
    # because Zitadel uses exact Host match for instance lookup
    local _host_header
    _host_header="$(zitadel_host_header "${hostname}:${ZITADEL_EXTERNALPORT}" "${ZITADEL_EXTERNALSECURE:-false}")"
    export ZITADEL_HOST_HEADER="$_host_header"
    export MACHINEKEY_PATH="$STATE_DIR/machinekey/zitadel-admin-sa.json"
    export STATE_FILE="$STATE_DIR/zitadel.env"
    export SYSTEM_API_KEY_PATH="$STATE_DIR/system-api/system-user.pem"
    export DOCKER_INTERNAL_HOST="zitadel-api"
    export CREATE_TEST_USER="true"
    export ZITADEL_HOSTNAME="$hostname"
    export DEPLOY_ENV_NAME="${DEPLOY_ENV:-public}"
    # Creates the Node-RED proxy secret, credential secret and service token.
    export FM_NODE_RED_ADDON_ENABLED="${WITH_NODERED:-false}"

    # Run bootstrap with retry
    local attempts=0
    local max_attempts=5
    while [ $attempts -lt $max_attempts ]; do
        attempts=$((attempts + 1))
        if run_quiet "Zitadel bootstrap" bash "$DEPLOY_DIR/scripts/common/bootstrap-zitadel.sh"; then
            ok "Bootstrap complete"
            return 0
        fi
        if [ $attempts -lt $max_attempts ]; then
            warn "Bootstrap attempt $attempts failed, retrying in 5s..."
            sleep 5
        fi
    done

    error "Bootstrap failed after $max_attempts attempts"
    return 1
}

# Runs a shared Zitadel admin script against the local API. Zitadel finds the
# instance by Host and accepts the admin key only with the public issuer as
# audience, so every call names the install's public host itself instead of
# relying on values an earlier bootstrap happened to export.
# Usage: zitadel_admin_script <hostname> <label> <script under scripts/common> [args]
zitadel_admin_script() {
    local hostname="$1" label="$2" script="$3"
    shift 3
    ZITADEL_URL="http://localhost:8080" \
    ZITADEL_HOST_HEADER="$(zitadel_host_header "${hostname}:${ZITADEL_EXTERNALPORT}" "${ZITADEL_EXTERNALSECURE:-false}")" \
    MACHINEKEY_PATH="$STATE_DIR/machinekey/zitadel-admin-sa.json" \
    STATE_FILE="$STATE_DIR/zitadel.env" \
        run_quiet "$label" bash "$DEPLOY_DIR/scripts/common/$script" "$@"
}

# Adds the MCP sign-in apps to an install whose bootstrap is not rerun, and
# saves their client ids in the state file; the caller regenerates the config.
sync_mcp_sign_in_apps() {
    local hostname="$1"
    zitadel_admin_script "$hostname" "MCP sign-in apps" zitadel/sync-mcp-apps.sh || {
        error "Could not ensure the MCP sign-in apps in Zitadel"
        return 1
    }
}

# Registers Action V2 webhook targets (GDPR cascade + grant-removed) — must
# run AFTER FM is up because Zitadel resolves the endpoint via DNS at create.
run_actions_bootstrap() {
    local hostname="$1"
    step "Registering Zitadel Action V2 webhook"
    if ! zitadel_admin_script "$hostname" "Action V2 bootstrap" bootstrap-zitadel-actions.sh; then
        error "Action V2 registration failed; user deletion/access revocation hooks are not safe"
        return 1
    fi
    if ! zitadel_admin_script "$hostname" "Action V2 verification" check-zitadel-actions.sh --quiet; then
        error "Action V2 verification failed after registration"
        return 1
    fi
    ok "Action V2 webhook registered"
}

# Fleet Manager verifies Action V2 calls with the signing keys in its runtime
# config, so the generated config must carry the keys Zitadel signs with.
verify_actions_runtime_config() {
    local hostname="$1"
    FM_RUNTIME_ENV_FILE="$STATE_DIR/fm-runtime.env" \
        zitadel_admin_script "$hostname" "Action V2 runtime config" check-zitadel-actions.sh --quiet || {
        error "Action V2 signing keys are missing from FM runtime config"
        return 1
    }
}

generate_fm_config() {
    local hostname="$1"

    export FM_HOSTNAME="$hostname"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT

    if ! run_quiet "Generating Fleet Manager OIDC config" bash "$DEPLOY_DIR/scripts/common/generate-fm-config.sh" --mode zitadel --target docker; then
        error "Fleet Manager OIDC config generation failed"
        return 1
    fi
    ok "Fleet Manager OIDC config generated"
}
