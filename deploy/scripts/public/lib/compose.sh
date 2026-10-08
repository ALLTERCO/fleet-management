# shellcheck shell=bash
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

    # The pins are already in the environment (lib/common/env.sh).
    local images=()
    images=(
        "timescale/timescaledb:${TIMESCALEDB_VERSION:-latest}"
        "${DOCKER_HUB_IMAGE}:${FM_VERSION:-latest}"
    )
    if [ "$FM_DEV_MODE" != "true" ]; then
        images+=(
            "postgres:${ZITADEL_POSTGRES_VERSION:-latest}"
            "ghcr.io/zitadel/zitadel:${ZITADEL_VERSION:-latest}"
        )
    fi

    if [ "$WITH_SSL" = "true" ]; then
        images+=("traefik:${TRAEFIK_VERSION:-latest}")
    fi
    if [ "$WITH_MDNS" = "true" ]; then
        images+=("shellygroup/mdns-repeater:${MDNS_REPEATER_VERSION:-latest}")
    fi
    if [ "${WITH_NODERED:-false}" = "true" ]; then
        local nodered_ref
        nodered_ref="$(nodered_image)" || return 1
        images+=("$nodered_ref")
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

# Compose labels every container with FM_BUILD_COMMIT, and smoke compares the
# Fleet Manager label with /version, which reports the commit baked into the
# image. So each command that starts Fleet Manager reads it from the image it
# starts. An image without the label keeps a commit the operator exported.
# Usage: public_resolve_build_identity <Fleet Manager image tag>
public_resolve_build_identity() {
    local tag="$1" commit
    commit="$(docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "${DOCKER_HUB_IMAGE:-shellygroup/fleet-management}:${tag}" 2>/dev/null || true)"
    [ -n "$commit" ] || return 0
    FM_BUILD_COMMIT="$commit"
    export FM_BUILD_COMMIT
}

# The logging overlay names the users file in every Compose model, but only a
# command that starts containers mounts it. `down` must work after the file
# is gone; the path itself comes from the environment or the saved deploy.
# Usage: validate_dozzle_users_file <compose subcommand>
validate_dozzle_users_file() {
    local subcommand="$1"
    if [ -z "${DOZZLE_USERS_FILE:-}" ]; then
        error "--logging requires DOZZLE_USERS_FILE (absolute path to a Dozzle users.yml)"
        return 1
    fi
    case "$DOZZLE_USERS_FILE" in
        /*) ;;
        *) error "DOZZLE_USERS_FILE must be an absolute path"; return 1 ;;
    esac
    case "$subcommand" in
        up|create|run|start|restart) ;;
        *) return 0 ;;
    esac
    if [ ! -r "$DOZZLE_USERS_FILE" ]; then
        error "DOZZLE_USERS_FILE is not readable: $DOZZLE_USERS_FILE"
        return 1
    fi
}

compose_cmd() {
    local env_args=()
    # Traefik joins this group to read the TLS key (see the traefik compose files).
    export FM_HOST_GID
    FM_HOST_GID="$(id -g)"
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

    # Load generated FM runtime config if available
    if [ -f "$STATE_DIR/fm-runtime.env" ]; then
        env_args+=(--env-file "$STATE_DIR/fm-runtime.env")
    fi

    compose_files=(-f "$COMPOSE_DIR/docker-compose.yml")
    if [ "$FM_DEV_MODE" = "true" ]; then
        # Dev runs Fleet Manager from source, so only the database and Redis are containers.
        compose_files+=(
            -f "$COMPOSE_DIR/docker-compose.selfhosted.yml"
            -f "$COMPOSE_DIR/docker-compose.dev-ports.yml"
        )
    else
        compose_files+=(
            -f "$COMPOSE_DIR/docker-compose.fleet-image.yml"
            -f "$COMPOSE_DIR/docker-compose.selfhosted.yml"
            -f "$COMPOSE_DIR/docker-compose.zitadel.yml"
        )
        if zitadel_identity_smtp_enabled; then
            validate_zitadel_identity_smtp || return 1
            compose_files+=(-f "$COMPOSE_DIR/docker-compose.zitadel-smtp.yml")
        fi

        # Direct FM and Zitadel port publication only when NOT behind Traefik (SSL).
        if [ "$WITH_SSL" != "true" ] && [ -f "$COMPOSE_DIR/docker-compose.fleet-image-ports.yml" ]; then
            compose_files+=(-f "$COMPOSE_DIR/docker-compose.fleet-image-ports.yml")
        fi
        if [ "$WITH_SSL" != "true" ]; then
            compose_files+=(-f "$COMPOSE_DIR/docker-compose.zitadel-ports.yml")
        fi
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
        validate_dozzle_users_file "${1:-}" || return 1
        compose_files+=(-f "$COMPOSE_DIR/docker-compose.logging.yml")
    fi

    # Optional: Node-RED automations (pinned by NODE_RED_VERSION in VERSIONS.env)
    if [ "${WITH_NODERED:-false}" = "true" ]; then
        nodered_check_files || return 1
        nodered_refresh_runtime_env || return 1
        compose_files+=(-f "$COMPOSE_DIR/docker-compose.nodered.yml")
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

    # FM_SKIP_IMAGE_PULL reuses local images: skip registry pulls entirely.
    if [ "${FM_SKIP_IMAGE_PULL:-}" = "true" ] && [ "${1:-}" = "pull" ]; then
        debug "Skipping compose pull (FM_SKIP_IMAGE_PULL=true)"
        return 0
    fi

    docker compose \
        -p "$COMPOSE_PROJECT_NAME" \
        "${env_args[@]}" \
        "${compose_files[@]}" \
        "$@"
}
