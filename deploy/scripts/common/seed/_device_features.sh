#!/usr/bin/env bash
# Device metadata plus optional live-device configuration.
# Runs after seed_energy_data populates the synthetic device pool.

set -euo pipefail

_seed_device_features() {
    local configure_live_devices="${1:-true}"
    local devices ids simulator_devices simulator_ids switch_ids
    devices=$(_seed_managed_devices)
    ids=$(echo "$devices" | jq -r '.[].shellyID')
    if [ -z "$ids" ]; then
        info "Device-dependent features — no seeded devices, skipping all"
        return 0
    fi
    if [ "$configure_live_devices" = "true" ]; then
        simulator_devices=$(_seed_simulator_devices "$devices")
        simulator_ids=$(echo "$simulator_devices" | jq -r '.[].shellyID')
        switch_ids=$(echo "$simulator_devices" | jq -r '
            .[] | select(.status["switch:0"]? != null) | .shellyID
        ')
        if [ -n "$simulator_ids" ]; then
            _seed_device_schedules "$switch_ids"
            _seed_device_webhooks "$switch_ids"
            _seed_device_certs "$simulator_ids"
            _seed_device_credentials "$simulator_ids"
        else
            info "Live-device features — no simulator inventory, skipping"
        fi
    fi
    _seed_device_group_membership "$ids"
    _seed_device_tag_attachments "$ids"
}

_seed_managed_devices() {
    local resp requested_json blu_json
    resp=$(_seed_rpc 'Device.List' '{"limit":0,"include":["status"]}' 2>/dev/null \
        || echo '{}')
    requested_json="${FM_SEED_DEVICE_IDS_JSON:-[]}"
    blu_json="${FM_SEED_BLU_DEVICE_IDS_JSON:-[]}"
    echo "$resp" | jq -c \
        --argjson requested "$requested_json" \
        --argjson blu "$blu_json" '
            [.items[]?
             | select(
                 (.shellyID as $id | $requested | index($id)) or
                 (.shellyID as $id | $blu | index($id)) or
                 ((.source // "") | startswith("demo-seed-"))
               )]
            | unique_by(.shellyID)
        ' 2>/dev/null
}

_seed_simulator_devices() {
    local devices="$1" requested_json
    requested_json="${FM_SEED_DEVICE_IDS_JSON:-[]}"
    echo "$devices" | jq -c --argjson requested "$requested_json" '
        [.[] | select(.shellyID as $id | $requested | index($id))]
    '
}

_seed_device_schedules() {
    info "Seeding schedules on multiple devices..."
    local ids="$1" count=0 id
    for id in $ids; do
        _seed_one_device_schedule "$id" && count=$((count + 1))
        [ "$count" -ge 3 ] && break
    done
    info "  schedule on $count device(s)"
}

_seed_one_device_schedule() {
    local id="$1" body resp existing existing_id
    existing=$(_seed_rpc 'Schedule.List' \
        "$(jq -cn --arg id "$id" '{shellyID:$id}')" 2>/dev/null || echo '{}')
    existing_id=$(echo "$existing" | jq -r '
        .items[]?
        | select(.timespec == "0 0 8 * * *")
        | select(any(.calls[]?; .method == "Switch.Set" and .params.id == 0 and .params.on == true))
        | .id
    ' 2>/dev/null | head -1)
    if [ -n "$existing_id" ]; then
        if echo "$existing" | jq -e --argjson id "$existing_id" '
            any(.items[]?; .id == $id and .enable == false)
        ' >/dev/null 2>&1; then
            return 0
        fi
        body=$(jq -cn --arg id "$id" --argjson schedule_id "$existing_id" \
            '{shellyID:$id,id:$schedule_id,enable:false}')
        resp=$(_seed_rpc 'Schedule.Update' "$body" 2>/dev/null || echo '{}')
        if ! echo "$resp" | jq -e '.error == null and .success == true' \
            >/dev/null 2>&1; then
            error "Failed to disable seeded schedule on $id"
            return 1
        fi
        return 0
    fi
    body=$(jq -cn --arg id "$id" '
        {shellyID:$id, timespec:"0 0 8 * * *", enable:false,
         calls:[{method:"Switch.Set", params:{id:0, on:true}}]}
    ')
    resp=$(_seed_rpc 'Schedule.Create' "$body" 2>/dev/null || echo '{}')
    echo "$resp" | jq -e '.error == null and (.id | type == "number")' \
        >/dev/null 2>&1
}

_seed_device_webhooks() {
    info "Seeding webhooks on multiple devices..."
    local ids="$1" count=0 id
    for id in $ids; do
        _seed_one_device_webhook "$id" && count=$((count + 1))
        [ "$count" -ge 3 ] && break
    done
    info "  webhook on $count device(s)"
}

_seed_one_device_webhook() {
    local id="$1" body resp existing
    existing=$(_seed_rpc 'Webhook.List' \
        "$(jq -cn --arg id "$id" '{shellyID:$id}')" 2>/dev/null || echo '{}')
    if echo "$existing" | jq -e '
        .hooks[]? | select(.name == "demo-switch-on")
    ' >/dev/null 2>&1; then
        return 0
    fi
    body=$(jq -cn --arg id "$id" '
        {shellyID:$id, cid:0, event:"switch.on",
         urls:["https://example.invalid/hook"], enable:true,
         name:"demo-switch-on"}
    ')
    resp=$(_seed_rpc 'Webhook.Create' "$body" 2>/dev/null || echo '{}')
    echo "$resp" | jq -e '.error == null and (.id | type == "number")' \
        >/dev/null 2>&1
}

_seed_device_certs() {
    info "Issuing device certs on multiple devices..."
    local ids="$1" count=0 id result name existing
    existing=$(_seed_rpc 'Certificate.List' \
        '{"source":"fm-issued","limit":500}' 2>/dev/null || echo '{}')
    for id in $ids; do
        name="cert for $id"
        if echo "$existing" | jq -e --arg name "$name" \
            '.items[]? | select(.name == $name)' >/dev/null 2>&1; then
            count=$((count + 1))
        elif _seed_one_device_cert "$id"; then
            count=$((count + 1))
        else
            result=$?
            if [ "$result" -eq 2 ]; then
                info "  skipped (FM CA unavailable)"
                return 0
            fi
        fi
        [ "$count" -ge 3 ] && break
    done
    info "  cert available on $count device(s)"
}

_seed_one_device_cert() {
    local id="$1" body resp
    body=$(jq -cn --arg id "$id" --arg name "cert for $id" '
        {shellyId:$id, name:$name, validityDays:90}
    ')
    resp=$(_seed_rpc 'Certificate.IssueDeviceCert' "$body" 2>/dev/null || echo '{}')
    if echo "$resp" | jq -e '
        .error.code == 1007 and
        .error.data.details.service == "fm-ca"
    ' >/dev/null 2>&1; then
        return 2
    fi
    echo "$resp" | jq -e '.id // empty' >/dev/null 2>&1
}

_seed_device_credentials() {
    info "Setting device credentials on multiple devices..."
    local ids="$1" count=0 id
    for id in $ids; do
        _seed_one_device_credential "$id" && count=$((count + 1))
        [ "$count" -ge 3 ] && break
    done
    info "  credentials set on $count device(s)"
}

_seed_one_device_credential() {
    local id="$1" body
    body=$(jq -cn --arg id "$id" '
        {deviceId:$id, password:"DemoSeedPassword!2026"}
    ')
    _seed_rpc 'Credential.Set' "$body" >/dev/null 2>&1
}

_seed_device_group_membership() {
    info "Adding devices to the Office Lighting group..."
    local group_id
    group_id=$(_seed_group_id_by_name 'Office Lighting')
    if [ -z "$group_id" ]; then
        info "  skipped — Office Lighting group not found"
        return 0
    fi
    local ids="$1" members
    members=$(_seed_subjects_array_for_devices "$ids" 3)
    if [ -z "$members" ] || [ "$members" = "[]" ]; then
        info "  skipped — no device subjects to add"
        return 0
    fi
    local body
    body=$(jq -nc --argjson id "$group_id" --argjson m "$members" \
        '{id:$id, members:$m}')
    if _seed_rpc 'Group.AddMembers' "$body" >/dev/null 2>&1; then
        info "  3 devices added to group $group_id"
    else
        info "  skipped (Group.AddMembers unavailable)"
    fi
}

_seed_device_tag_attachments() {
    info "Attaching the 'demo' tag to the first 3 devices..."
    local tag_id
    tag_id=$(_seed_tag_id_by_name 'demo')
    if [ -z "$tag_id" ]; then
        info "  skipped — 'demo' tag not found"
        return 0
    fi
    local ids="$1" subjects
    subjects=$(_seed_subjects_array_for_devices "$ids" 3)
    if [ -z "$subjects" ] || [ "$subjects" = "[]" ]; then
        info "  skipped — no device subjects to tag"
        return 0
    fi
    local body
    body=$(jq -nc --argjson id "$tag_id" --argjson s "$subjects" \
        '{id:$id, subjects:$s}')
    if _seed_rpc 'Tag.Assign' "$body" >/dev/null 2>&1; then
        info "  tagged 3 devices"
    else
        info "  skipped (Tag.Assign unavailable)"
    fi
}

_seed_group_id_by_name() {
    local name="$1"
    _seed_rpc 'Group.List' '{}' 2>/dev/null \
        | jq -r --arg n "$name" '.items[]? | select(.name == $n) | .id' \
        | head -1
}

_seed_tag_id_by_name() {
    local name="$1"
    _seed_rpc 'Tag.List' '{}' 2>/dev/null \
        | jq -r --arg n "$name" '.items[]? | select(.name == $n) | .id' \
        | head -1
}

# Builds device subjects for group membership and tag assignment.
_seed_subjects_array_for_devices() {
    local ids="$1" cap="$2" picked
    picked=$(echo "$ids" | head -n "$cap")
    [ -z "$picked" ] && {
        echo '[]'
        return
    }
    echo "$picked" | jq -R -s -c 'split("\n") | map(select(length > 0))
        | map({subjectType:"device", subjectId:.})'
}
