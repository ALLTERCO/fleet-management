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

# Registers Action V2 webhook targets (GDPR cascade + grant-removed) — must
# run AFTER FM is up because Zitadel resolves the endpoint via DNS at create.
run_actions_bootstrap() {
    step "Registering Zitadel Action V2 webhook"
    export ZITADEL_URL="${ZITADEL_URL:-http://localhost:8080}"
    export MACHINEKEY_PATH="${MACHINEKEY_PATH:-$STATE_DIR/machinekey/zitadel-admin-sa.json}"
    export STATE_FILE="${STATE_FILE:-$STATE_DIR/zitadel.env}"
    if ! run_quiet "Action V2 bootstrap" \
        bash "$DEPLOY_DIR/scripts/common/bootstrap-zitadel-actions.sh"; then
        error "Action V2 registration failed; user deletion/access revocation hooks are not safe"
        return 1
    fi
    if ! run_quiet "Action V2 verification" \
        bash "$DEPLOY_DIR/scripts/common/check-zitadel-actions.sh" --quiet; then
        error "Action V2 verification failed after registration"
        return 1
    fi
    ok "Action V2 webhook registered"
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
