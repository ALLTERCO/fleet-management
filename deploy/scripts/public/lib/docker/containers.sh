# shellcheck shell=bash
# Container naming, health, and cleanup helpers.

container_name() {
    printf '%s-%s-1' "$COMPOSE_PROJECT_NAME" "$1"
}

container_health_status() {
    local container="$1"
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo "missing"
}

container_exists() {
    local container="$1"
    docker ps -a --filter "name=^${container}$" --format '{{.Names}}' 2>/dev/null | grep -qx "$container"
}

cleanup_orphan_optional_containers() {
    local orphans=()
    local service
    local container

    for service in traefik mdns; do
        container="$(container_name "$service")"
        if ! container_exists "$container"; then
            continue
        fi

        case "$service" in
            traefik)
                [ "$WITH_SSL" = "true" ] && continue
                ;;
            mdns)
                [ "$WITH_MDNS" = "true" ] && continue
                ;;
        esac

        orphans+=("$container")
    done

    [ ${#orphans[@]} -gt 0 ] || return 0

    warn "Detected stack containers from an older topology: ${orphans[*]}"
    info "Removing orphaned optional containers that are not part of the current configuration..."
    if ! docker rm -f "${orphans[@]}" >/dev/null 2>&1; then
        warn "Failed to remove one or more orphaned optional containers"
        return 1
    fi
    ok "Removed orphaned optional containers: ${orphans[*]}"
}

wait_for_container_health() {
    local service="$1"
    local timeout="${2:-120}"
    local container
    container="$(container_name "$service")"

    local elapsed=0
    local health_status=""
    while [ "$elapsed" -lt "$timeout" ]; do
        health_status="$(container_health_status "$container")"
        case "$health_status" in
            healthy|running)
                if [ -n "$SPINNER_PID" ]; then
                    spinner_update "Waiting for services to become healthy... (${service} ready ${elapsed}s)"
                else
                    ok "${service} is ready (${elapsed}s)"
                fi
                return 0
                ;;
            unhealthy)
                if [ -n "$SPINNER_PID" ]; then
                    spinner_update "Waiting for services to become healthy... (${service} unhealthy ${elapsed}s)"
                else
                    warn "${service} healthcheck is reporting unhealthy (${elapsed}s)"
                fi
                ;;
            *)
                if [ -n "$SPINNER_PID" ]; then
                    spinner_update "Waiting for services to become healthy... (${service} ${health_status} ${elapsed}s)"
                fi
                ;;
        esac
        sleep 3
        elapsed=$((elapsed + 3))
    done

    return 1
}
