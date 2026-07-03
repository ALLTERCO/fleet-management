#!/usr/bin/env bash
# Features that require devices in device.list: schedules, webhooks,
# credentials, device certs, group membership, tag attachments.
# Runs AFTER seed_energy_data populates the synthetic device pool.

set -euo pipefail

_seed_device_features() {
    local ids
    ids=$(_seed_seeded_device_ids)
    if [ -z "$ids" ]; then
        info "Device-dependent features — no seeded devices, skipping all"
        return 0
    fi
    _seed_device_schedules "$ids"
    _seed_device_webhooks "$ids"
    _seed_device_certs "$ids"
    _seed_device_credentials "$ids"
    _seed_device_group_membership "$ids"
    _seed_device_tag_attachments "$ids"
}

_seed_seeded_device_ids() {
    local resp
    resp=$(_seed_rpc 'Device.List' '{"limit":50}' 2>/dev/null \
        || echo '{}')
    echo "$resp" \
        | jq -r '.items[]? | .external_id // .externalId // empty' 2>/dev/null
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
    local id="$1" body
    body=$(jq -cn --arg id "$id" '
        {shellyID:$id, timespec:"0 0 8 * * *", enable:true,
         calls:[{method:"Switch.Set", params:{id:0, on:true}}]}
    ')
    _seed_rpc 'Schedule.Create' "$body" >/dev/null 2>&1
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
    local id="$1" body
    body=$(jq -cn --arg id "$id" '
        {shellyID:$id, cid:0, event:"switch.on",
         urls:["https://example.invalid/hook"], enable:true,
         name:"demo-switch-on"}
    ')
    _seed_rpc 'Webhook.Create' "$body" >/dev/null 2>&1
}

_seed_device_certs() {
    info "Issuing device certs on multiple devices..."
    local ids="$1" count=0 id
    for id in $ids; do
        _seed_one_device_cert "$id" && count=$((count + 1))
        [ "$count" -ge 3 ] && break
    done
    info "  cert issued on $count device(s)"
}

_seed_one_device_cert() {
    local id="$1" body resp
    body=$(jq -cn --arg id "$id" --arg name "cert for $id" '
        {shellyId:$id, name:$name, validityDays:90}
    ')
    resp=$(_seed_rpc 'Certificate.IssueDeviceCert' "$body" 2>/dev/null \
        || echo '{}')
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

# Builds [{subjectType:"device",subjectId:"X"}, ...] for the first `cap`
# device ids. Used by both group membership and tag assignment.
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
