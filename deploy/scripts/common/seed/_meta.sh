#!/usr/bin/env bash
# Tags, device groups, and the Office Operator persona + admin assignment.

set -euo pipefail

_seed_meta() {
    _seed_meta_tags
    _seed_meta_groups
    _seed_meta_persona_and_assignment
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
        body=$(jq -cn --arg n "$name" --arg d "$desc" --arg k "$kind" \
            '{name:$n,description:$d,kind:$k}')
        _seed_rpc_log 'group.create' "$body" "  group $name ($kind)"
    done
}

_seed_meta_persona_and_assignment() {
    info "Creating Office Operator persona + admin assignment..."
    local persona_id admin_user_id
    persona_id=$(_seed_create_office_operator_persona)
    [ -z "$persona_id" ] && return 0
    [ -z "${SEED_BUILDING_IDS[0]:-}" ] && return 0
    admin_user_id=$(_seed_first_admin_user_id)
    _seed_assign_admin_to_sofia "$persona_id" "$admin_user_id"
}

_seed_create_office_operator_persona() {
    local resp
    resp=$(_seed_rpc 'Persona.Create' \
        '{"key":"office-operator","name":"Office Operator","description":"Read-only access to devices, groups, locations, tags.","statements":[{"effect":"Allow","actions":["device:read","group:read","location:read","tag:read"],"resource_types":["device","group","location","tag"]}]}')
    echo "$resp" | jq -r '.id // empty'
}

_seed_first_admin_user_id() {
    _seed_rpc 'User.ListZitadelUsers' '{}' \
        | jq -r '.items[0].userId // empty'
}

_seed_assign_admin_to_sofia() {
    local persona_id="$1" admin_user_id="$2"
    if [ "$admin_user_id" = "dev-admin" ]; then
        info "  Skipping persona assignment — synthetic dev-admin (no Zitadel)"
        return 0
    fi
    [ -z "$admin_user_id" ] && return 0
    local sofia="${SEED_BUILDING_IDS[0]}" resp
    resp=$(_seed_rpc 'Assignment.Create' \
        "{\"subjectType\":\"user\",\"subjectId\":\"$admin_user_id\",\"personaId\":\"$persona_id\",\"scope\":{\"location_ids\":[$sofia]}}")
    if echo "$resp" | jq -e '.id // empty' >/dev/null 2>&1; then
        info "  Office Operator scoped to Sofia HQ for admin"
    else
        info "  Persona assignment skipped: $(echo "$resp" | jq -r '.error.message // "unknown"')"
    fi
}
