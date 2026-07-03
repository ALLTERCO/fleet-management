# shellcheck shell=bash
# lib/docker.sh — Docker compatibility loader.

DOCKER_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/docker" && pwd)"

# shellcheck source=deploy/scripts/public/lib/docker/host.sh
source "$DOCKER_LIB_DIR/host.sh"
# shellcheck source=deploy/scripts/public/lib/docker/checks.sh
source "$DOCKER_LIB_DIR/checks.sh"
# shellcheck source=deploy/scripts/public/lib/docker/containers.sh
source "$DOCKER_LIB_DIR/containers.sh"
