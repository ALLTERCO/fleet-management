#!/usr/bin/env bash
# Public CLI adapter for the seeder. Body in deploy/scripts/common/seed-lib.sh.
set -euo pipefail
# shellcheck source=/dev/null
source "$DEPLOY_DIR/scripts/common/seed-lib.sh"

cmd_seed() {
    local reset=false
    local with_devices=true
    local dev=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --reset) reset=true; shift ;;
            --no-devices) with_devices=false; shift ;;
            --with-devices) with_devices=true; shift ;;
            --dev) dev=true; shift ;;
            -h|--help) _seed_help_public; return 0 ;;
            *) error "Unknown seed option: $1"; _seed_help_public; return 1 ;;
        esac
    done

    seed_load_base_url "$dev"
    if [ "$dev" = "true" ]; then
        seed_load_token_dev
        # Synthetic device + telemetry synth keys off ENV_NAME — without
        # this, the energy dashboard stays empty after seed --dev.
        export ENV_NAME="${ENV_NAME:-local}"
    else
        seed_load_token_zitadel
    fi
    seed_run "$reset" "$with_devices"
}

_seed_help_public() {
    cat <<HELP
Usage: ./deploy/deploy-public.sh seed [--reset] [--no-devices] [--dev]

  Populates the deployed FM with reviewable demo data via the live API.

Options:
  --reset          Delete seeded markers (country roots + dashboards) first.
  --no-devices     Skip the waiting-room-accept + widget step.
  --dev            Use admin/admin local-auth login instead of Zitadel.
                   Override creds: FM_SEED_DEV_USER / FM_SEED_DEV_PASSWORD.
HELP
}
