# shellcheck shell=bash
# Host OS, architecture, and IP detection.
#
# IP detection is shared with the private deploy path via
# deploy/scripts/common/host-ip.sh (one exclusion list that drops docker,
# bridge, loopback, link-local, and VPN/tunnel interfaces). detect_all_ips /
# detect_ip below are thin public-facing wrappers over the shared detectors.
_DOCKER_HOST_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/common/host-ip.sh
source "$_DOCKER_HOST_LIB_DIR/../../../common/host-ip.sh"

detect_os() {
    local os="" distro="" arch=""

    case "$(uname -s)" in
        Linux)  os="linux" ;;
        Darwin) os="macos" ;;
        *)      error "Unsupported OS: $(uname -s)"; exit 1 ;;
    esac

    arch="$(uname -m)"
    case "$arch" in
        x86_64)  arch="amd64" ;;
        aarch64) arch="arm64" ;;
        arm64)   arch="arm64" ;;
        *)       error "Unsupported architecture: $arch"; exit 1 ;;
    esac

    if [ "$os" = "linux" ]; then
        if [ -f /etc/os-release ]; then
            # shellcheck source=/dev/null
            . /etc/os-release
            case "$ID" in
                ubuntu|debian|raspbian) distro="debian" ;;
                arch|manjaro)           distro="arch" ;;
                *)
                    if [ -n "${ID_LIKE:-}" ]; then
                        case "$ID_LIKE" in
                            *debian*|*ubuntu*) distro="debian" ;;
                            *arch*)            distro="arch" ;;
                        esac
                    fi
                    ;;
            esac
        fi
        if [ -z "$distro" ]; then
            error "Unsupported Linux distribution. Supported: Ubuntu, Debian, Raspberry Pi OS (arm64), Arch Linux"
            exit 1
        fi
        if [ "$arch" = "arm64" ] && [ "$distro" = "debian" ]; then
            info "Detected Raspberry Pi (arm64)"
        fi
    fi

    # shellcheck disable=SC2034 # Sourced modules read these globals.
    OS="$os"
    # shellcheck disable=SC2034 # Sourced modules read these globals.
    DISTRO="$distro"
    # shellcheck disable=SC2034 # Sourced modules read these globals.
    ARCH="$arch"
}

# All usable host IPv4s, sorted and de-duplicated for display and the
# multi-interface picker. Delegates to the shared detector so the public path
# uses the same docker/bridge/VPN exclusion list as the private path.
detect_all_ips() {
    detect_all_host_ips | sort -u
}

# Single host IP for hostname/URL derivation. Never fails: falls back to
# "localhost" so callers can print a value unconditionally.
detect_ip() {
    detect_host_ip 2>/dev/null || echo "localhost"
}
