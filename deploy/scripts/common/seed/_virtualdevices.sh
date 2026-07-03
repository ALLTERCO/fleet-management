#!/usr/bin/env bash
# Composed virtual devices bound to an org-local demo profile.

set -euo pipefail

_seed_virtual_devices() {
    info "Seeding virtual devices..."
    local profile_id
    profile_id=$(_seed_demo_profile_id)
    if [ -z "$profile_id" ]; then
        info "  skipped — no virtualdevice profiles available"
        return 0
    fi
    local devices=(
        'Demo HVAC unit:climate'
        'Demo lighting bank:lighting'
    )
    local entry name type
    for entry in "${devices[@]}"; do
        name="${entry%%:*}"
        type="${entry#*:}"
        _seed_one_virtual_device "$name" "$type" "$profile_id"
    done
}

_seed_one_virtual_device() {
    local name="$1" type="$2" profile_id="$3" payload
    payload=$(jq -nc --arg n "$name" --arg t "$type" --arg p "$profile_id" '
        {kind:"composed", name:$n, typeKey:$t, profileId:$p}
    ')
    if _seed_rpc 'VirtualDevice.Create' "$payload" >/dev/null 2>&1; then
        info "  $name"
    else
        info "  $name — skipped"
    fi
}

_seed_demo_profile_id() {
    local resp profile_id
    resp=$(_seed_rpc 'VirtualDevice.Profile.List' '{"limit":50}' 2>/dev/null \
        || echo '{}')
    profile_id=$(echo "$resp" \
        | jq -r '.items[]? | select(.key == "demo_seed" and .organizationId != null) | .id' \
        2>/dev/null | head -n1
    )
    if [ -n "$profile_id" ]; then
        echo "$profile_id"
        return 0
    fi
    _seed_create_demo_profile
}

_seed_create_demo_profile() {
    local body resp
    body=$(jq -nc '
        {
            key:"demo_seed",
            name:"Demo virtual device",
            roles:[
                {
                    roleKey:"state",
                    label:"State",
                    valueType:"boolean",
                    writable:true,
                    required:false,
                    historyMode:"live_only"
                }
            ]
        }
    ')
    resp=$(_seed_rpc 'VirtualDevice.Profile.Create' "$body" 2>/dev/null \
        || echo '{}')
    echo "$resp" | jq -r '.id // empty' 2>/dev/null
}
