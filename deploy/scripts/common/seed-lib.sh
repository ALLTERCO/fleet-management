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
source "$_SEED_DIR/_accounting.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_composed_devices.sh"

# Business Manager demo fixtures. The registry is generic and always ships;
# the fixtures themselves are excluded from the public export, so the hook
# lists stay empty in the community build and every phase is a no-op there.
# shellcheck source=/dev/null
source "$_SEED_DIR/_bm_registry.sh"
for _bm_module in "$_SEED_DIR/bm-demo"/_*.sh; do
    [ -e "$_bm_module" ] || continue
    # shellcheck source=/dev/null
    source "$_bm_module"
done
unset _bm_module

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
source "$(dirname "$_SEED_DIR")/seed-simulator-sensor-history.sh"
# shellcheck source=/dev/null
source "$(dirname "$_SEED_DIR")/seed-simulator-watering-history.sh"
# shellcheck source=/dev/null
source "$(dirname "$_SEED_DIR")/seed-environment-data.sh"
# shellcheck source=/dev/null
source "$(dirname "$_SEED_DIR")/seed-template-history.sh"
# shellcheck source=/dev/null
source "$_SEED_DIR/_e2e_extraction_host.sh"

_seed_finalize_device_data() {
    local with_devices="$1"
    # Every device feature in here is generic demo furniture — a demo schedule,
    # a demo webhook, the "Office Lighting" group, the "demo" tag. The control
    # dashboard is not: it renders the fixture's own devices.
    if _seed_generic_demo_enabled; then
        _seed_device_features "$with_devices"
    fi
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
        seed_simulator_sensor_history
        seed_simulator_watering_history
    else
        # A profile that declares its own simulator estate owns every reading
        # this environment shows, so the generic demo devices are not a
        # substitute for it. Falling through to them silently is how a 25-store
        # grocery fleet ended up with no history at all while 50 unrelated
        # demo-em-* devices carried 30 days: both branches report success, so
        # the seed looked clean and the dashboard drew one column.
        local fixture_dir="${DEPLOY_DIR:-$(cd "$_SEED_DIR/../../.." && pwd)}/seed"
        local profile_fixture="$fixture_dir/${FM_SEED_PROFILE:-}.json"
        if [ -n "${FM_SEED_PROFILE:-}" ] && [ -f "$profile_fixture" ] \
            && [ "$(jq -r 'has("simulator")' "$profile_fixture")" = "true" ]; then
            error "Profile ${FM_SEED_PROFILE} declares a simulator estate, but no device ids reached the seed (FM_SEED_DEVICE_IDS_JSON is empty). Refusing to substitute generic demo energy devices."
            return 1
        fi
        seed_energy_data
    fi
    # The generic environment sensors are demo furniture like the tags and groups.
    if _seed_generic_demo_enabled; then
        seed_environment_data
    fi
    # Whatever generated history THIS template ships (seed/<id>-*-history.sql).
    # The generic generators above cannot know a template's own estate: a
    # cold-chain retail fixture needs its fixture-defined history window on
    # every probe, not one sensor per family, or its records cannot be
    # developed.
    seed_template_history
    # E2E extraction-host fixture — a store-written device the browser tests
    # read; registered by the same reconcile below. Test envs only (this whole
    # function is gated to them), so it never lands in a community seed. A
    # fixture that opted out of the generic demo shows its estate to people, not
    # to the browser tests, so the extra host would only be an unexplained device.
    if _seed_generic_demo_enabled; then
        seed_e2e_extraction_host
    fi
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
        # Tags, office groups, the Office Operator persona, action variables and
        # the automation actions are all office-demo objects; the fixture's own
        # locations, alerting and notifications below are not.
        if _seed_generic_demo_enabled; then
            _seed_meta
            _seed_variables
            _seed_actions
        fi
        _seed_notification_destinations
        _seed_notification_templates
        _seed_alert_rules
        _seed_service_users
        _seed_persona_assignments
        _seed_scoped_pats
        # The two "Demo ..." virtual devices and the "Demo Seed CA" certificate
        # belong to nobody in a customer story.
        if _seed_generic_demo_enabled; then
            _seed_virtual_devices
            _seed_certificates
        fi
    fi
    bm_demo_run prepare
    _seed_fixture_accounting
    _seed_dashboards
    if [ "$with_devices" = "true" ]; then
        _seed_wait_for_requested_devices
        _seed_accept_waiting_room_devices
        _seed_wait_for_requested_devices_online
        _seed_configure_simulated_bluetooth
        bm_demo_run assign
        # After _seed_configure_simulated_bluetooth: a vending machine's door
        # contact is a promoted BLU child, and it only exists once its gateway
        # or plug has been paired.
        bm_demo_run assign_after_blu
        _seed_assign_single_location_fixture_devices
        _seed_assign_fixture_device_locations
        _seed_configure_fixture_device_assignments
        bm_demo_run assign_late
    fi
    # Floorplans are skipped for a business-manager template: no BM template
    # renders one today, so uploading one is work with no reader. It also logged
    # "Sofia HQ" while attaching to whatever location id 5 happened to be, which
    # in a retail fixture database is a store building — a confusing line in the
    # seed output that suggested another client's data had leaked in.
    if [ -z "${FM_DEV_TEMPLATE_ID:-}" ] && _seed_generic_demo_enabled; then
        _seed_attach_floorplan
    fi
    # Non-prod test/dev envs and demo platforms only: synthesize energy devices
    # + telemetry so the energy dashboard has data to render. NEVER for prod / public.
    case "${FM_ENVIRONMENT_ID:-${ENV_NAME:-}}" in
        dev|local|cloud-test|office-test|bm-demo)
            _seed_telemetry_history
            ;;
        *) ;;
    esac
    _seed_finalize_device_data "$with_devices"
    bm_demo_run alerts
    ok "Seed complete — open ${FM_BASE_URL}/organize/locations to review"
}
