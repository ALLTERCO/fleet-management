# shellcheck shell=bash
# common/logging.sh — public deploy terminal output helpers.

IS_TTY=false
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null)" -ge 8 ]; then
    IS_TTY=true
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    CYAN=$(tput setaf 6)
    WHITE=$(tput setaf 7)
    DIM=$(tput setaf 4)
    BOLD=$(tput bold)
    RESET=$(tput sgr0)
    CLR="\033[K"
else
    IS_TTY=false
    RED="" GREEN="" YELLOW="" CYAN="" WHITE="" DIM="" BOLD="" RESET=""
    CLR=""
fi

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

step() { echo "  ${BOLD}$*${RESET}"; }

# Inline value colorizers — wrap printed values (URLs, paths, ports,
# credentials, IDs) so they pop against the surrounding prose. All are
# no-ops on non-TTY (NO_COLOR or piped output).
cv_url()   { printf '%s' "${CYAN}${1}${RESET}"; }
cv_path()  { printf '%s' "${CYAN}${1}${RESET}"; }
cv_port()  { printf '%s' "${BOLD}${WHITE}${1}${RESET}"; }
cv_ok()    { printf '%s' "${GREEN}${1}${RESET}"; }
cv_warn()  { printf '%s' "${YELLOW}${1}${RESET}"; }
cv_id()    { printf '%s' "${BOLD}${1}${RESET}"; }
cv_dim()   { printf '%s' "${DIM}${1}${RESET}"; }
# Credentials are deliberately bold-yellow so they stand out enough to
# remind operators to redact when sharing logs.
cv_cred()  { printf '%s' "${BOLD}${YELLOW}${1}${RESET}"; }

phase() {
    echo ""
    echo "  ${DIM}────────────────────────────────────────────${RESET}"
    echo "  ${BOLD}${WHITE}$*${RESET}"
    echo ""
}

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
    local result="${1:-ok}"
    local msg="${2:-$SPINNER_MSG}"
    if [ -n "$SPINNER_PID" ]; then
        kill "$SPINNER_PID" 2>/dev/null || true
        wait "$SPINNER_PID" 2>/dev/null || true
        SPINNER_PID=""
    fi
    if [ -n "$SPINNER_MSG_FILE" ]; then rm -f "$SPINNER_MSG_FILE"; SPINNER_MSG_FILE=""; fi
    if [ "$IS_TTY" = "true" ] && [ "$DEBUG_MODE" != "true" ]; then
        printf '\r%s' "$CLR"
    fi
    case "$result" in
        ok)   ok "$msg" ;;
        warn) warn "$msg" ;;
        fail) error "$msg" ;;
    esac
}
