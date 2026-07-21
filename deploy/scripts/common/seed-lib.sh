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
# shellcheck source=/dev/null
source "$(dirname "$_SEED_DIR")/seed-energy-data.sh"
# shellcheck source=/dev/null
source "$(dirname "$_SEED_DIR")/seed-simulator-energy-history.sh"
# shellcheck source=/dev/null
source "$(dirname "$_SEED_DIR")/seed-environment-data.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_e2e_extraction_host.sh"

_seed_finalize_device_data() {
    local with_devices="$1"
    _seed_device_features "$with_devices"
    _seed_reconcile_control_dashboard
}

_seed_telemetry_history() {
    local requested_json="${FM_SEED_DEVICE_IDS_JSON:-[]}"
    if ! validate_simulator_seed_inventory "$requested_json"; then
        error "Simulator inventory must be an array of unique, non-empty device IDs."
        return 1
    fi
    if [ "$(jq 'length' <<<"$requested_json")" -gt 0 ]; then
        retire_energy_seed_devices
        seed_simulator_energy_history
    else
        seed_energy_data
    fi
    seed_environment_data
    # E2E extraction-host fixture — a store-written device the browser tests
    # read; registered by the same reconcile below. Test envs only (this whole
    # function is gated to them), so it never lands in a community seed.
    seed_e2e_extraction_host
    # The energy fallback, env sensors and e2e host write device rows straight
    # to the store; a running FM only loads devices at boot, so ask it to
    # register the new rows now. Already-connected devices are left untouched.
    _seed_rpc_log 'Admin.ReconcileDevices' '{}' \
        '  Reconciled seeded devices into the running FM'
}

seed_run() {
    local reset="${1:-false}"
    local with_devices="${2:-true}"
    : "${FM_BASE_URL:?FM_BASE_URL not set}"
    : "${FM_SEED_TOKEN:?FM_SEED_TOKEN not set}"
    _seed_validate_environment || return 1
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
    _seed_dashboards
    if [ "$with_devices" = "true" ]; then
        _seed_wait_for_requested_devices
        _seed_accept_waiting_room_devices
        _seed_wait_for_requested_devices_online
        _seed_configure_simulated_bluetooth
    fi
    _seed_attach_floorplan
    # Non-prod test/dev envs only: synthesize energy devices + telemetry so
    # the energy dashboard has data to render. NEVER for prod / public.
    case "${FM_ENVIRONMENT_ID:-${ENV_NAME:-}}" in
        dev|local|cloud-test|office-test)
            _seed_telemetry_history
            ;;
        *) ;;
    esac
    _seed_finalize_device_data "$with_devices"
    ok "Seed complete — open ${FM_BASE_URL}/organize/locations to review"
}
