# shellcheck shell=bash
# Host OS, architecture, and IP detection.

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

detect_all_ips() {
    local ips=""

    if command -v ip &>/dev/null; then
        ips=$(ip -4 addr show scope global 2>/dev/null \
            | awk '/^[0-9]+:/ { iface=$2 } /inet / { print iface, $2 }' \
            | grep -vE '^(docker[0-9]*|br-|veth)' \
            | awk '{sub(/\/.*/, "", $2); print $2}' \
            | sort -u || true)
    fi

    if [ -z "$ips" ] && command -v ifconfig &>/dev/null; then
        ips=$(ifconfig 2>/dev/null \
            | grep 'inet ' | grep -v '127.0.0.1' \
            | awk '{print $2}' | sort -u || true)
    fi

    echo "$ips"
}

detect_ip() {
    local ip=""

    if command -v ip &>/dev/null; then
        ip=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -1 2>/dev/null || true)
    fi

    if [ -z "$ip" ] && command -v hostname &>/dev/null; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    fi

    if [ -z "$ip" ] && command -v ifconfig &>/dev/null; then
        ip=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -1 || true)
    fi

    if [ -z "$ip" ] && command -v route &>/dev/null; then
        local iface
        iface=$(route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}' || true)
        if [ -n "$iface" ]; then
            ip=$(ifconfig "$iface" 2>/dev/null | grep 'inet ' | awk '{print $2}' || true)
        fi
    fi

    echo "${ip:-localhost}"
}
