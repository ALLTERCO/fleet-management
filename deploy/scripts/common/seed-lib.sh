#!/usr/bin/env bash
# Demo data seeder — orchestration only. Each feature lives in its own
# module under deploy/scripts/common/seed/. CLI adapters in
# deploy/scripts/{public,private}/commands/seed.sh source this file.

set -euo pipefail

_SEED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/seed" && pwd)"

# shellcheck source=/dev/null
source "$_SEED_DIR/_common.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_locations.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_meta.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_dashboards.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_actions.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_notifications.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_users.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_virtualdevices.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_certificates.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_device_features.sh"

seed_run() {
    local reset="${1:-false}"
    local with_devices="${2:-true}"
    : "${FM_BASE_URL:?FM_BASE_URL not set}"
    : "${FM_SEED_TOKEN:?FM_SEED_TOKEN not set}"
    seed_wait_until_ready || return 1
    if [ "$reset" = "true" ]; then
        info "Reset requested — deleting seeded country roots + dashboards..."
        _seed_reset
    fi
    if _seed_already_seeded; then
        info "Demo data already present — skipping create phase."
        # Floorplan attach + device-features both read SEED_BUILDING_IDS;
        # re-derive from Location.List so re-runs still wire them up.
        _seed_load_building_ids
    else
        info "Seeding office hierarchy via $FM_BASE_URL ..."
        _seed_offices
        _seed_meta
        _seed_dashboards
        _seed_variables
        _seed_actions
        _seed_notification_destinations
        _seed_notification_templates
        _seed_alert_rules
        _seed_service_users
        _seed_persona_assignments
        _seed_scoped_pats
        _seed_virtual_devices
        _seed_certificates
    fi
    if [ "$with_devices" = "true" ]; then
        _seed_accept_waiting_room_and_attach_widgets
    fi
    _seed_attach_floorplan
    # Non-prod test/dev envs only: synthesize energy devices + telemetry so
    # the energy dashboard has data to render. NEVER for prod / public.
    case "${ENV_NAME:-}" in
        dev|local|cloud-test|office-test)
            # shellcheck source=/dev/null
            source "$DEPLOY_DIR/scripts/common/seed-energy-data.sh"
            seed_energy_data
            _seed_device_features
            ;;
        *) ;;
    esac
    ok "Seed complete — open ${FM_BASE_URL}/organize/locations to review"
}
