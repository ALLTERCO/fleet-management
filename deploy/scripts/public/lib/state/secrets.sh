# shellcheck shell=bash
# Public-flow wrapper around common/secrets.sh + public-only System API keypair.

# shellcheck source=deploy/scripts/common/secrets.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../../common/secrets.sh"
# shellcheck source=deploy/scripts/common/zitadel-system-api-config.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../../common/zitadel-system-api-config.sh"

generate_system_api_keypair() {
    local sa_dir="$STATE_DIR/system-api"
    zitadel_generate_system_api_files \
        "$sa_dir" \
        "/system-api/system-user.pub" \
        "deploy-public.sh"
}
