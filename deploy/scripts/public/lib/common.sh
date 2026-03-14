# lib/common.sh — shared utilities (logging, colors, spinner, constants)

# ── Version ───────────────────────────────────────────────────
FM_SCRIPT_VERSION="2.0.0"

# ── Colors & terminal ─────────────────────────────────────────
IS_TTY=false
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null)" -ge 8 ]; then
    IS_TTY=true
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    BLUE=$(tput setaf 4)
    MAGENTA=$(tput setaf 5)
    CYAN=$(tput setaf 6)
    WHITE=$(tput setaf 7)
    DIM=$(tput setaf 4)   # blue as dim
    BOLD=$(tput bold)
    RESET=$(tput sgr0)
    CLR="\033[K"          # clear to end of line
else
    IS_TTY=false
    RED="" GREEN="" YELLOW="" BLUE="" MAGENTA="" CYAN="" WHITE="" DIM="" BOLD="" RESET=""
    CLR=""
fi

# ── Logging ───────────────────────────────────────────────────
if [ "$IS_TTY" = "true" ]; then
    info()  { echo "  ${DIM}→${RESET}  $*"; }
    warn()  { echo "  ${YELLOW}!${RESET}  $*"; }
    error() { echo "  ${RED}✘${RESET}  $*" >&2; }
    ok()    { echo "  ${GREEN}✔${RESET}  $*"; }
    debug() { [ "${DEBUG_MODE:-false}" = "true" ] && echo "  ${CYAN}…${RESET}  $*" || true; }
else
    info()  { echo "[INFO]  $*"; }
    warn()  { echo "[WARN]  $*"; }
    error() { echo "[ERROR] $*" >&2; }
    ok()    { echo "[OK]    $*"; }
    debug() { [ "${DEBUG_MODE:-false}" = "true" ] && echo "[DEBUG] $*" || true; }
fi
step()  { echo "  ${BOLD}$*${RESET}"; }
phase() {
    echo ""
    echo "  ${DIM}────────────────────────────────────────────${RESET}"
    echo "  ${BOLD}${WHITE}$*${RESET}"
    echo ""
}

# ── Spinner ───────────────────────────────────────────────────
# Usage: spinner_start "message" ; do_work ; spinner_stop
# The message file allows the parent shell to update the spinner text
# while the background subshell is running (subshells can't see parent vars).
SPINNER_PID=""
SPINNER_MSG=""
SPINNER_MSG_FILE=""
SPINNER_FRAMES=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")

spinner_start() {
    SPINNER_MSG="$1"
    if [ "$IS_TTY" = "true" ] && [ "$DEBUG_MODE" != "true" ]; then
        SPINNER_MSG_FILE=$(mktemp "${TMPDIR:-/tmp}/spinner.XXXXXX")
        echo "$SPINNER_MSG" > "$SPINNER_MSG_FILE"
        (
            i=0
            while true; do
                msg=$(cat "$SPINNER_MSG_FILE" 2>/dev/null || echo "$SPINNER_MSG")
                printf "\r  ${CYAN}%s${RESET}  %s${CLR}" "${SPINNER_FRAMES[$((i % 10))]}" "$msg" 2>/dev/null
                i=$((i + 1))
                sleep 0.1
            done
        ) &
        SPINNER_PID=$!
    else
        echo "[....] $SPINNER_MSG"
    fi
}

spinner_update() {
    SPINNER_MSG="$1"
    [ -n "$SPINNER_MSG_FILE" ] && echo "$1" > "$SPINNER_MSG_FILE" 2>/dev/null || true
}

spinner_stop() {
    local result="${1:-ok}"  # ok, warn, fail
    local msg="${2:-$SPINNER_MSG}"
    if [ -n "$SPINNER_PID" ]; then
        kill "$SPINNER_PID" 2>/dev/null || true
        wait "$SPINNER_PID" 2>/dev/null || true
        SPINNER_PID=""
    fi
    if [ -n "$SPINNER_MSG_FILE" ]; then rm -f "$SPINNER_MSG_FILE"; SPINNER_MSG_FILE=""; fi
    if [ "$IS_TTY" = "true" ] && [ "$DEBUG_MODE" != "true" ]; then
        printf "\r${CLR}"
    fi
    case "$result" in
        ok)   ok "$msg" ;;
        warn) warn "$msg" ;;
        fail) error "$msg" ;;
    esac
}

# ── Global state vars ─────────────────────────────────────────
AUTO_INSTALL_FROM_UP="${AUTO_INSTALL_FROM_UP:-false}"
USE_SUDO_DOCKER="${USE_SUDO_DOCKER:-false}"
DEBUG_MODE="${DEBUG_MODE:-false}"
PARSED_GLOBAL_ARGS=()

docker() {
    if [ "$USE_SUDO_DOCKER" = "true" ]; then
        command sudo docker "$@"
    else
        command docker "$@"
    fi
}

enable_debug_mode() {
    if [ "$DEBUG_MODE" != "true" ]; then
        return 0
    fi

    export PS4='+ [deploy-public:${LINENO}] '
    info "Debug mode enabled — shell commands will be traced."
    set -x
}

run_quiet() {
    local label="$1"
    shift

    if [ "$DEBUG_MODE" = "true" ]; then
        "$@"
        return $?
    fi

    local log_file
    log_file=$(mktemp "${TMPDIR:-/tmp}/deploy-public.XXXXXX")

    local status=0
    "$@" >"$log_file" 2>&1 || status=$?

    if [ "$status" -ne 0 ]; then
        [ -n "$label" ] && error "$label failed"
        if [ -s "$log_file" ]; then
            sed 's/^/    /' "$log_file" >&2
        fi
    fi
    rm -f "$log_file"
    return "$status"
}

# ── Constants ─────────────────────────────────────────────────
FM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DEPLOY_DIR="$FM_DIR/deploy"
STATE_DIR="$DEPLOY_DIR/state"
DEPLOY_META_FILE="$STATE_DIR/deploy-meta.env"
COMPOSE_DIR="$DEPLOY_DIR/compose"
VERSIONS_FILE="$DEPLOY_DIR/VERSIONS.env"

# Docker Hub image
DOCKER_HUB_IMAGE="shellygroup/fleet-management"

# ── Load defaults from public.env ─────────────────────────────
# public.env provides pre-configured demo credentials and sensible defaults.
# Environment variables set before running this script take precedence.
PUBLIC_ENV_FILE="$DEPLOY_DIR/env/public.env"
if [ -f "$PUBLIC_ENV_FILE" ]; then
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | xargs)
        if [ -z "${!key:-}" ]; then
            export "$key=$value"
        fi
    done < "$PUBLIC_ENV_FILE"
fi

# ── Defaults (fallbacks if public.env is missing) ─────────────
: "${FM_VERSION:=latest}"
: "${FLEET_MANAGER_PORT:=7011}"
: "${ZITADEL_EXTERNALPORT:=9090}"
: "${COMPOSE_PROJECT_NAME:=fm}"

# ── Addon / SSL flags ────────────────────────────────────────
WITH_MDNS="${WITH_MDNS:-false}"
WITH_SSL="${WITH_SSL:-false}"
SSL_MODE="${SSL_MODE:-}"  # "letsencrypt" | "selfsigned" | "custom"
SSL_DOMAIN="${SSL_DOMAIN:-}"
SSL_EMAIL="${SSL_EMAIL:-}"
SSL_CERT_FILE="${SSL_CERT_FILE:-}"
SSL_KEY_FILE="${SSL_KEY_FILE:-}"
WITH_LOGGING="${WITH_LOGGING:-false}"

parse_runtime_flags() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --debug)
                DEBUG_MODE=true
                shift ;;
            --mdns)
                WITH_MDNS=true
                shift ;;
            --logging)
                WITH_LOGGING=true
                shift ;;
            --with)
                error "Unknown flag: --with"
                error "Use --mdns for mDNS device discovery"
                return 1 ;;
            --ssl)
                WITH_SSL=true
                case "${2:-}" in
                    selfsigned|self-signed)
                        SSL_MODE="selfsigned"
                        shift 2
                        ;;
                    letsencrypt)
                        SSL_MODE="letsencrypt"
                        shift 2
                        ;;
                    custom)
                        SSL_MODE="custom"
                        shift 2
                        ;;
                    *)
                        SSL_MODE="letsencrypt"
                        shift
                        ;;
                esac
                ;;
            --domain)
                [ $# -ge 2 ] || {
                    error "--domain requires a value"
                    return 1
                }
                SSL_DOMAIN="${2:-}"
                shift 2 ;;
            --email)
                [ $# -ge 2 ] || {
                    error "--email requires a value"
                    return 1
                }
                SSL_EMAIL="${2:-}"
                shift 2 ;;
            --cert)
                [ $# -ge 2 ] || {
                    error "--cert requires a file path"
                    return 1
                }
                SSL_CERT_FILE="${2:-}"
                shift 2 ;;
            --key)
                [ $# -ge 2 ] || {
                    error "--key requires a file path"
                    return 1
                }
                SSL_KEY_FILE="${2:-}"
                shift 2 ;;
            *)
                error "Unknown flag: $1"
                return 1
                ;;
        esac
    done
}

parse_global_flags() {
    PARSED_GLOBAL_ARGS=()

    while [ $# -gt 0 ]; do
        case "$1" in
            --debug)
                DEBUG_MODE=true
                ;;
            *)
                PARSED_GLOBAL_ARGS+=("$1")
                ;;
        esac
        shift
    done
}
