# shellcheck shell=bash
# Shared health-wait + diagnostic dump. Sourced by public deploy-public.sh
# and private deploy.sh. Callers set COMPOSE_PROJECT_NAME before use.

# Container name from docker-compose service name using the active project.
hc_container_name() {
    local service="$1"
    if declare -f compat_service_container_name >/dev/null 2>&1; then
        local resolved
        resolved="$(compat_service_container_name "${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME unset}" "$service" 2>/dev/null || true)"
        if [ -n "$resolved" ]; then
            printf '%s' "$resolved"
            return 0
        fi
    fi
    printf '%s-%s-1' "${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME unset}" "$service"
}

# "healthy" | "running" | "unhealthy" | "starting" | "missing" | "<State.Status>"
hc_status() {
    local container="$1"
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$container" 2>/dev/null || echo "missing"
}

# Dump state, exit code, ports, and last N log lines to stderr.
hc_dump_diagnostics() {
    local service="$1"
    local lines="${2:-200}"
    local container
    container="$(hc_container_name "$service")"
    {
        echo ""
        echo "--- $container diagnostics ---"
        echo "  Health: $(hc_status "$container")"
        echo "  State:  $(docker inspect -f '{{.State.Status}} (exit {{.State.ExitCode}})' "$container" 2>/dev/null || echo 'unknown')"
        local ports
        ports="$(docker port "$container" 2>/dev/null | paste -sd ', ' -)"
        [ -n "$ports" ] && echo "  Ports:  $ports"
        echo "--- $container logs (last $lines lines) ---"
        docker logs --tail "$lines" "$container" 2>&1 | sed 's/^/    /'
        echo "--- end $container logs ---"
        echo ""
    } >&2
}

# Wait until `<service>` is healthy/running. On timeout, dump diagnostics
# and return 1. Timeout defaults to 120s, override per call.
# Usage: hc_wait_or_dump <service> [<timeout_s>] [<tail_lines>]
hc_wait_or_dump() {
    local service="$1"
    local timeout="${2:-120}"
    local tail_lines="${3:-200}"
    local container
    container="$(hc_container_name "$service")"
    local elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        local status
        status="$(hc_status "$container")"
        case "$status" in
            healthy|running) return 0 ;;
            exited|dead)
                hc_dump_diagnostics "$service" "$tail_lines"
                return 1
                ;;
        esac
        sleep 3
        elapsed=$((elapsed + 3))
    done
    hc_dump_diagnostics "$service" "$tail_lines"
    return 1
}
