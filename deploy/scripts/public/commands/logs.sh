# shellcheck shell=bash
cmd_logs() {
    enable_debug_mode
    load_state_env
    load_deploy_meta

    export ZITADEL_HOSTNAME="${ZITADEL_HOSTNAME:-localhost}"
    export ZITADEL_EXTERNALPORT
    export FLEET_MANAGER_PORT
    export FM_VERSION

    compose_cmd logs --tail 100 -f "$@"
}
