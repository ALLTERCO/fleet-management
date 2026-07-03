# shellcheck shell=bash
# Post-update smoke tests. Without SMOKE_TOKEN only /health is probed;
# with a token we also probe the RPC surface. UPD_NO_SMOKE=1 skips.

# Usage: sm_http_health <base_url>
sm_http_health() {
    local base="$1"
    local body
    if body="$(curl -sk --max-time 10 "$base/health")" \
        && echo "$body" | grep -q '"online"[[:space:]]*:[[:space:]]*true'; then
        return 0
    fi
    sm_container_health "${SMOKE_CONTAINER_SERVICE:-}"
}

sm_container_health() {
    local service="$1"
    [ -n "$service" ] || return 1

    local container
    container="$(hc_container_name "$service")"
    docker exec "$container" node -e '
        const url = "http://127.0.0.1:" + (process.env.FM_HTTP_PORT || "7011") + "/health";
        fetch(url)
            .then(async (res) => {
                const body = await res.text();
                if (!res.ok || !/"online"\s*:\s*true/.test(body)) process.exit(1);
            })
            .catch(() => process.exit(1));
    ' >/dev/null 2>&1
}

# Probe N methods via HTTP /rpc/<method>. Each must return 200 with
# non-error JSON. Requires a bearer token (service account / PAT).
# Usage: sm_rpc_probes <base_url> <bearer_token> <method1> <method2> ...
sm_rpc_probes() {
    local base="$1"
    local token="$2"
    shift 2
    local failed=0
    for method in "$@"; do
        local resp
        resp="$(curl -sk --max-time 15 \
            -H "Authorization: Bearer $token" \
            -H "Content-Type: application/json" \
            -X POST \
            -d '{}' \
            "$base/rpc/$method")" || { failed=$((failed + 1)); echo "  [smoke-fail] $method: no response" >&2; continue; }
        # Fail if JSON-RPC error object present
        if echo "$resp" | grep -q '"error"[[:space:]]*:'; then
            echo "  [smoke-fail] $method: error response $(echo "$resp" | head -c 200)" >&2
            failed=$((failed + 1))
        fi
    done
    return $failed
}

# Run the default smoke suite — health + 3 read-only RPCs.
# Usage: sm_run_default <base_url> [<bearer_token>]
# When token is empty, only /health is checked.
sm_run_default() {
    local base="$1"
    local token="$2"
    if ! sm_http_health "$base"; then
        echo "  [smoke-fail] /health did not respond online=true" >&2
        return 1
    fi
    if [ -z "$token" ]; then
        sm_run_external "$base" ""
        return $?
    fi
    # Auth-free (NoPermissions) + viewer-readable probes — no CRUD scope
    # required, so the smoke passes regardless of token role.
    sm_rpc_probes "$base" "$token" \
        system.getvariables \
        system.getstatus || return 1
    sm_run_external "$base" "$token"
}

sm_run_external() {
    local base="$1"
    local token="$2"
    local script="${UPD_SMOKE_SCRIPT:-}"
    [ -n "$script" ] || return 0
    [ -x "$script" ] || [ -f "$script" ] || {
        echo "  [smoke-fail] external smoke script not found: $script" >&2
        return 1
    }

    local -a args=(--url "$base")
    if [ "${UPD_SMOKE_SKIP_DEVICES:-1}" = "1" ]; then
        args+=(--skip-devices)
    fi
    if [ -n "$token" ]; then
        args+=(--admin-token "$token")
    fi
    bash "$script" "${args[@]}"
}
