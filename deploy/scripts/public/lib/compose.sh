# lib/compose.sh — Docker Compose file assembly and image verification

verify_images() {
    # Check that required Docker images exist locally.
    #
    # 'up' never pulls from a registry — it uses whatever is cached.
    #   - First run: images are missing, so Compose pulls them automatically
    #     (default pull_policy: missing). This is the only time 'up' triggers a pull.
    #   - Subsequent runs: cached images are reused as-is, no registry contact.
    #
    # To get newer images, use 'upgrade' which runs 'docker compose pull'
    # before delegating to 'up'.
    #
    # Skip checks entirely with FM_SKIP_IMAGE_VERIFY=true (used in CI where
    # images are built locally and never come from a registry).
    if [ "${FM_SKIP_IMAGE_VERIFY:-}" = "true" ]; then
        info "Skipping image verification (FM_SKIP_IMAGE_VERIFY=true)"
        return 0
    fi

    local images=()
    local versions_file="$VERSIONS_FILE"

    if [ -f "$versions_file" ]; then
        # shellcheck source=/dev/null
        source "$versions_file"
    fi

    images=(
        "timescale/timescaledb:${TIMESCALEDB_VERSION:-latest}"
        "postgres:${ZITADEL_POSTGRES_VERSION:-latest}"
        "ghcr.io/zitadel/zitadel:${ZITADEL_VERSION:-latest}"
        "${DOCKER_HUB_IMAGE}:${FM_VERSION:-latest}"
    )

    if [ "$WITH_SSL" = "true" ]; then
        images+=("traefik:${TRAEFIK_VERSION:-latest}")
    fi
    if [ "$WITH_MDNS" = "true" ]; then
        images+=("shellygroup/mdns-repeater:${MDNS_REPEATER_VERSION:-latest}")
    fi

    local missing=0
    for img in "${images[@]}"; do
        if local_image_exists "$img"; then
            ok "$img"
        else
            info "$img (not cached — will be pulled)"
            missing=$((missing + 1))
        fi
    done

    if [ $missing -gt 0 ]; then
        info "Compose will pull $missing missing image(s) on startup"
    fi
}

compose_cmd() {
    local env_args=()
    local compose_files=()

    # Load VERSIONS.env
    if [ -f "$VERSIONS_FILE" ]; then
        env_args+=(--env-file "$VERSIONS_FILE")
    fi

    # public.env values are already loaded into shell env (lines 65-75).
    # Shell env is used by Docker Compose for YAML substitution,
    # so we don't pass --env-file here — avoids precedence conflicts
    # when callers override vars (e.g., FLEET_MANAGER_PORT=7012 in CI).

    # Load saved state env
    if [ -f "$STATE_DIR/.env" ]; then
        env_args+=(--env-file "$STATE_DIR/.env")
    fi

    # Load OIDC config if available
    if [ -f "$STATE_DIR/fm-oidc.env" ]; then
        env_args+=(--env-file "$STATE_DIR/fm-oidc.env")
    fi

    # Core compose files (always included)
    compose_files=(
        -f "$COMPOSE_DIR/docker-compose.yml"
        -f "$COMPOSE_DIR/docker-compose.zitadel.yml"
        -f "$COMPOSE_DIR/docker-compose.fleet-image.yml"
        -f "$COMPOSE_DIR/docker-compose.selfhosted.yml"
    )

    # Direct public FM port publication: only when NOT behind Traefik (SSL)
    if [ "$WITH_SSL" != "true" ] && [ -f "$COMPOSE_DIR/docker-compose.fleet-image-ports.yml" ]; then
        compose_files+=(-f "$COMPOSE_DIR/docker-compose.fleet-image-ports.yml")
    fi

    # Zitadel port publication: only when NOT behind Traefik (SSL)
    if [ "$WITH_SSL" != "true" ]; then
        compose_files+=(-f "$COMPOSE_DIR/docker-compose.zitadel-ports.yml")
    fi

    # Optional: mDNS repeater
    if [ "$WITH_MDNS" = "true" ] && [ -f "$COMPOSE_DIR/docker-compose.mdns.yml" ]; then
        # Auto-detect network interface if not set in env
        if [ -z "${MDNS_ON:-}" ] || [ "$MDNS_ON" = "eth0" ]; then
            MDNS_ON=$(ip route | grep default | awk '{print $5}' | head -1)
            export MDNS_ON
            info "Auto-detected MDNS_ON=$MDNS_ON (default route interface)"
        fi
        if [ -z "${MDNS_TO:-}" ] || [ "$MDNS_TO" = "br-fleet-public" ]; then
            MDNS_TO="br-${COMPOSE_PROJECT_NAME:-fleet-public}"
            export MDNS_TO
            info "Auto-detected MDNS_TO=$MDNS_TO (Docker bridge network)"
        fi
        compose_files+=(-f "$COMPOSE_DIR/docker-compose.mdns.yml")
    fi

    # Optional: Dozzle log viewer
    if [ "$WITH_LOGGING" = "true" ] && [ -f "$COMPOSE_DIR/docker-compose.logging.yml" ]; then
        compose_files+=(-f "$COMPOSE_DIR/docker-compose.logging.yml")
    fi

    # Optional: Traefik with SSL — explicit mode selection
    if [ "$WITH_SSL" = "true" ]; then
        case "$SSL_MODE" in
            selfsigned|custom)
                compose_files+=(-f "$COMPOSE_DIR/docker-compose.traefik-selfsigned.yml")
                ;;
            letsencrypt)
                compose_files+=(-f "$COMPOSE_DIR/docker-compose.traefik-public.yml")
                ;;
            *)
                error "compose_cmd: unknown SSL_MODE '$SSL_MODE'"
                return 1
                ;;
        esac
    fi

    # Log loaded compose files
    local file_names=""
    for arg in "${compose_files[@]}"; do
        [ "$arg" = "-f" ] && continue
        file_names="${file_names:+$file_names, }$(basename "$arg")"
    done
    debug "Compose files: ${file_names}"

    docker compose \
        -p "$COMPOSE_PROJECT_NAME" \
        "${env_args[@]}" \
        "${compose_files[@]}" \
        "$@"
}
