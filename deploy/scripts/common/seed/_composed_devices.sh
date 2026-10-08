#!/usr/bin/env bash
# Shared reconciliation for fixture-owned composed devices.

set -euo pipefail

_seed_reconcile_composed_device() {
    local name="$1" type_key="$2" location_id="$3" group_ids="$4"
    local bindings="$5" metadata="$6" reason="$7" label="$8"
    local existing existing_item external_id binding role_key binding_list
    local device revision body response

    existing=$(_seed_rpc 'virtualdevice.List' '{"limit":1000}' 2>/dev/null || echo '{}')
    existing_item=$(jq -c --arg name "$name" \
        'first(.items[]? | select(.name == $name)) // empty' <<<"$existing")
    if [ -n "$existing_item" ]; then
        external_id=$(jq -r '.externalId // empty' <<<"$existing_item")
        [ -n "$external_id" ] || {
            error "$label $name has no external id."
            return 1
        }

        while IFS= read -r binding; do
            role_key=$(jq -r '.roleKey' <<<"$binding")
            binding_list=$(_seed_rpc 'virtualdevice.Binding.List' \
                "$(jq -cn --arg externalId "$external_id" '{externalId:$externalId}')")
            if jq -e --arg role "$role_key" \
                '.items[]? | select(.roleKey == $role and .active == true)' \
                <<<"$binding_list" >/dev/null 2>&1; then
                continue
            fi

            device=$(_seed_rpc 'virtualdevice.Get' \
                "$(jq -cn --arg externalId "$external_id" '{externalId:$externalId}')")
            revision=$(jq -r '.revision // empty' <<<"$device")
            [[ "$revision" =~ ^[1-9][0-9]*$ ]] || {
                error "$label $name has no valid revision."
                return 1
            }
            body=$(jq -cn --arg externalId "$external_id" \
                --argjson expectedRevision "$revision" --argjson binding "$binding" \
                --arg reason "$reason" \
                '{externalId:$externalId, roleKey:$binding.roleKey,
                  source:$binding.source, expectedRevision:$expectedRevision,
                  effectiveFrom:$binding.effectiveFrom, reason:$reason}')
            response=$(_seed_rpc 'virtualdevice.Binding.Create' "$body")
            jq -e '.id // empty' <<<"$response" >/dev/null 2>&1 || {
                error "$label role $name/$role_key failed: $response"
                return 1
            }
        done < <(jq -c '.[]' <<<"$bindings")
        info "  $label $name"
        return 0
    fi

    body=$(jq -cn --arg name "$name" --arg typeKey "$type_key" \
        --argjson locationId "$location_id" --argjson groupIds "$group_ids" \
        --argjson bindings "$bindings" --argjson metadata "$metadata" \
        '{kind:"composed",name:$name,typeKey:$typeKey,locationId:$locationId,
          groupIds:$groupIds,bindings:$bindings,metadata:$metadata}')
    response=$(_seed_rpc 'virtualdevice.Create' "$body")
    jq -e '.id // .externalId' <<<"$response" >/dev/null 2>&1 || {
        error "$label $name failed: $response"
        return 1
    }
    info "  $label $name"
}
