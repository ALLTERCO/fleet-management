#!/usr/bin/env bash
# Zitadel service users + persona assignments for them.

set -euo pipefail

_seed_service_users() {
    info "Seeding service users..."
    if [ "${FM_SEED_AUTH_MODE:-}" = "dev" ]; then
        info "  skipped — dev-mode has no Zitadel service users"
        return 0
    fi
    local users=(
        'svc-grafana:Grafana dashboard scraper'
        'svc-nodered:Node-RED bridge'
    )
    local entry uname desc
    for entry in "${users[@]}"; do
        uname="${entry%%:*}"
        desc="${entry#*:}"
        if _seed_rpc 'User.CreateServiceUser' \
            "{\"userName\":\"$uname\",\"name\":\"$uname\",\"description\":\"$desc\"}" \
            >/dev/null 2>&1; then
            info "  $uname"
        else
            info "  $uname — skipped (Zitadel unreachable or duplicate)"
        fi
    done
}

# Assign the Office Operator persona to each seeded service user, scoped
# to the Sofia HQ building. Runs after _seed_meta + _seed_service_users.
_seed_persona_assignments() {
    info "Assigning Office Operator persona to service users..."
    if [ "${FM_SEED_AUTH_MODE:-}" = "dev" ]; then
        info "  skipped — dev-mode has no Zitadel service users"
        return 0
    fi
    local persona_id sofia_id
    persona_id=$(_seed_persona_id_by_key 'office-operator')
    sofia_id="${SEED_BUILDING_IDS[0]:-}"
    if [ -z "$persona_id" ] || [ -z "$sofia_id" ]; then
        info "  skipped — persona or Sofia building id missing"
        return 0
    fi
    local svc_users
    svc_users=$(_seed_service_user_ids)
    [ -z "$svc_users" ] && {
        info "  skipped — no service users present"
        return 0
    }
    local svc_id
    for svc_id in $svc_users; do
        _seed_assign_persona_to_subject "$persona_id" "$svc_id" "$sofia_id"
    done
}

_seed_persona_id_by_key() {
    local key="$1"
    _seed_rpc 'Persona.List' '{}' 2>/dev/null \
        | jq -r --arg k "$key" '.items[]? | select(.key == $k) | .id' \
        | head -1
}

_seed_service_user_ids() {
    _seed_rpc 'User.ListServiceUsers' '{}' 2>/dev/null \
        | jq -r '.items[]? | .userId // .id // empty'
}

_seed_assign_persona_to_subject() {
    local persona_id="$1" subject_id="$2" sofia_id="$3" resp
    resp=$(_seed_rpc 'Assignment.Create' \
        "{\"subjectType\":\"user\",\"subjectId\":\"$subject_id\",\"personaId\":\"$persona_id\",\"scope\":{\"location_ids\":[$sofia_id]}}")
    if echo "$resp" | jq -e '.id // empty' >/dev/null 2>&1; then
        info "  assigned to $subject_id"
    else
        info "  $subject_id — $(echo "$resp" | jq -r '.error.message // "skipped"')"
    fi
}

# Mint a long-lived FM scoped PAT for each seeded service user, scoped to
# Sofia HQ. Tokens are returned once — persist them under deploy/state so
# test scripts (Grafana / Node-RED bridge) have a Bearer to use.
_seed_scoped_pats() {
    info "Minting scoped PATs for service users..."
    if [ "${FM_SEED_AUTH_MODE:-}" = "dev" ]; then
        info "  skipped — dev-mode has no Zitadel service users"
        return 0
    fi
    local sofia_id="${SEED_BUILDING_IDS[0]:-}"
    if [ -z "$sofia_id" ]; then
        info "  skipped — Sofia building id missing"
        return 0
    fi
    local out_file="$DEPLOY_DIR/state/seed-pats.json"
    mkdir -p "$(dirname "$out_file")"
    printf '{}\n' >"$out_file"
    chmod 0600 "$out_file"
    local users_resp
    users_resp=$(_seed_rpc 'User.ListServiceUsers' '{}' 2>/dev/null \
        || echo '{}')
    local count=0 user_row
    while IFS= read -r user_row; do
        [ -z "$user_row" ] && continue
        local uid uname
        uid=$(echo "$user_row" | jq -r '.userId // .id // empty')
        uname=$(echo "$user_row" | jq -r '.userName // .name // empty')
        [ -z "$uid" ] && continue
        _seed_mint_one_scoped_pat "$uid" "$uname" "$sofia_id" "$out_file" \
            && count=$((count + 1))
    done < <(echo "$users_resp" | jq -c '.items[]? // empty')
    info "  minted $count PAT(s); tokens at $out_file"
}

_seed_mint_one_scoped_pat() {
    local uid="$1" uname="$2" sofia_id="$3" out_file="$4"
    local body resp token
    body=$(jq -nc --arg uid "$uid" --argjson sofia "$sofia_id" \
        --arg purpose "demo seed PAT for $uname" '
            {userId:$uid,
             boundaryScope:{location_ids:[$sofia]},
             purpose:$purpose,
             expirationDays:365}
        ')
    resp=$(_seed_rpc 'User.CreateScopedPAT' "$body" 2>/dev/null \
        || echo '{}')
    token=$(echo "$resp" | jq -r '.token // empty')
    if [ -z "$token" ]; then
        info "  $uname — skipped ($(echo "$resp" | jq -r '.error.message // "RPC unavailable"'))"
        return 1
    fi
    # Merge into the state file so re-runs accumulate rather than clobber.
    local merged
    merged=$(jq --arg n "$uname" --arg t "$token" '. + {($n):$t}' "$out_file")
    printf '%s\n' "$merged" >"$out_file"
    chmod 0600 "$out_file"
    info "  $uname"
}
