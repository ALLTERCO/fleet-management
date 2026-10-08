#!/usr/bin/env bash
# Demo personas must not narrow the administrator's effective permissions.

set -euo pipefail

_seed_meta() {
    _seed_meta_tags
    _seed_meta_groups
    _seed_create_office_operator_persona >/dev/null
}

_seed_meta_tags() {
    info "Creating tags..."
    # name | color (hex #rrggbb) | icon (semantic slug)
    local rows=(
        'indoor|#4495d1|fa-house'
        'outdoor|#2eb872|fa-tree'
        'critical|#e23636|fa-triangle-exclamation'
        'demo|#a06bff|fa-flask'
        'production|#003c82|fa-industry'
        'staging|#f5a623|fa-flask-vial'
    )
    local row name color icon body
    for row in "${rows[@]}"; do
        name="${row%%|*}"
        local rest="${row#*|}"
        color="${rest%%|*}"
        icon="${rest#*|}"
        body=$(jq -cn --arg n "$name" --arg c "$color" --arg i "$icon" \
            '{name:$n, color:$c, icon:$i}')
        _seed_rpc_log 'tag.create' "$body" "  tag $name"
    done
}

_seed_meta_groups() {
    info "Creating device groups..."
    local existing
    existing=$(_seed_rpc 'Group.List' '{}')
    # name | description | group kind (id from GROUP_KIND_CATALOG)
    for row in \
        "Office Lighting|Lights in office spaces|lighting_zone" \
        "Servers|Server-room equipment|server_rack" \
        "HVAC|Heating, ventilation, A/C|hvac_zone" \
        "Energy Meters|Power monitoring devices|circuit"
    do
        local name kind rest desc body
        name="${row%%|*}"
        kind="${row##*|}"
        rest="${row#*|}"
        desc="${rest%|*}"
        if echo "$existing" | jq -e --arg n "$name" \
            '.items[]? | select(.name == $n)' >/dev/null; then
            info "  group $name ($kind)"
            continue
        fi
        body=$(jq -cn --arg n "$name" --arg d "$desc" --arg k "$kind" \
            '{name:$n,description:$d,kind:$k}')
        _seed_rpc_log 'group.create' "$body" "  group $name ($kind)"
    done
}

_seed_create_office_operator_persona() {
    local persona_id resp
    persona_id=$(_seed_persona_id_by_key 'office-operator')
    if [ -n "$persona_id" ]; then
        printf '%s\n' "$persona_id"
        return 0
    fi
    resp=$(_seed_rpc 'Persona.Create' \
        '{"key":"office-operator","name":"Office Operator","description":"Read-only access to devices, groups, locations, tags.","statements":[{"effect":"Allow","actions":["device:read","group:read","location:read","tag:read"],"resource_types":["device","group","location","tag"]}]}')
    persona_id=$(echo "$resp" | jq -r '.id // empty')
    if [ -z "$persona_id" ]; then
        persona_id=$(_seed_persona_id_by_key 'office-operator')
    fi
    printf '%s\n' "$persona_id"
}

_seed_persona_id_by_key() {
    local key="$1"
    _seed_rpc 'Persona.List' '{"includeSystem":false}' 2>/dev/null \
        | jq -r --arg k "$key" '.items[]? | select(.key == $k) | .id' \
        | head -1
}
