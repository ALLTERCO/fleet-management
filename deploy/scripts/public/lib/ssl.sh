# shellcheck shell=bash
# lib/ssl.sh — TLS compatibility loader.

SSL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/ssl" && pwd)"

# shellcheck source=deploy/scripts/public/lib/ssl/validate.sh
source "$SSL_LIB_DIR/validate.sh"
# shellcheck source=deploy/scripts/public/lib/ssl/routes.sh
source "$SSL_LIB_DIR/routes.sh"
# shellcheck source=deploy/scripts/public/lib/ssl/selfsigned.sh
source "$SSL_LIB_DIR/selfsigned.sh"
