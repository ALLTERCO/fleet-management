#!/usr/bin/env bash
# Demo dashboards + waiting-room widget attach.

set -euo pipefail

_seed_dashboards() {
    info "Creating dashboards..."
    local office_id
    _seed_create_dashboard 'Energy Overview' 'energy' >/dev/null
    office_id=$(_seed_create_dashboard 'Office Status' 'overview')
    _seed_create_dashboard 'Sites Map' 'map' >/dev/null
    # Persist the office-status id so the device-attach step can find it
    # without re-listing dashboards.
    SEED_OFFICE_DASHBOARD_ID="$office_id"
}

_seed_create_dashboard() {
    local name="$1" type="$2" id
    id=$(_seed_rpc 'Dashboard.Create' \
        "{\"name\":\"$name\",\"dashboardType\":\"$type\"}" \
        | jq -r '.id // empty')
    info "  $name (id=$id, type=$type)"
    echo "$id"
}

_seed_accept_waiting_room_and_attach_widgets() {
    info "Checking waiting room for pending devices..."
    local pending_resp pending_count
    pending_resp=$(_seed_rpc 'WaitingRoom.GetPending' '{}')
    pending_count=$(echo "$pending_resp" | jq '.items | length' 2>/dev/null \
        || echo 0)
    if [ "$pending_count" = "0" ] || [ -z "$pending_count" ]; then
        info "  No pending devices — skipping accept + widget step."
        return 0
    fi
    info "  Found $pending_count pending device(s) — accepting..."
    local ids
    ids=$(echo "$pending_resp" | jq -c '[.items[].id]')
    _seed_rpc 'WaitingRoom.AcceptPendingById' "{\"ids\":$ids}" >/dev/null
    _seed_attach_widgets_to_office_dashboard
}

_seed_attach_widgets_to_office_dashboard() {
    local dashboard_id
    dashboard_id=$(_seed_resolve_office_dashboard_id)
    if [ -z "$dashboard_id" ]; then
        info "  Office Status dashboard not found — skipping widget attach."
        return 0
    fi
    info "Attaching 2x2 widgets to dashboard $dashboard_id..."
    local devices_resp device_ids dev_id added=0 body
    devices_resp=$(_seed_rpc 'Device.List' '{}')
    device_ids=$(echo "$devices_resp" | jq -r '.items[]?.id // empty')
    for dev_id in $device_ids; do
        body=$(jq -cn \
            --argjson dash "$dashboard_id" \
            --argjson did "$dev_id" \
            '{dashboardId:$dash,kind:"device",deviceId:$did,size:"2x2"}')
        if _seed_rpc 'Dashboard.Item.Add' "$body" >/dev/null 2>&1; then
            added=$((added + 1))
        fi
    done
    info "  Attached $added widget(s) to Office Status."
}

_seed_resolve_office_dashboard_id() {
    local id="${SEED_OFFICE_DASHBOARD_ID:-}"
    [ -n "$id" ] && {
        echo "$id"
        return
    }
    _seed_rpc 'Dashboard.List' '{}' \
        | jq -r '.items[]? | select(.name=="Office Status") | .id' \
        | head -1
}
