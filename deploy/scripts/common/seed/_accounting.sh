#!/usr/bin/env bash
# Fixture-owned tariffs and emission factors.
# `demoAccounting` is synthetic and must say so in every name; `accounting`
# holds reference tariffs a customer may see, so it only needs a source.

set -euo pipefail

_seed_accounting_fixture() {
    local fixture
    [ -n "${FM_SEED_PROFILE:-}" ] || return 1
    fixture="$DEPLOY_DIR/seed/${FM_SEED_PROFILE}.json"
    [ -f "$fixture" ] || return 1
    jq -e '(.demoAccounting | type == "object") or (.accounting | type == "object")' \
        "$fixture" >/dev/null 2>&1 || return 1
    printf '%s\n' "$fixture"
}

_seed_fixture_accounting_validate() {
    local fixture="$1"
    if ! jq -e '
        def assignments_ok:
            (.assignments | type == "array" and length > 0) and
            (.assignments | all(
                (.scopeLevel == "organization" and (has("locationIndex") | not)) or
                (.scopeLevel == "location" and
                    (.locationIndex | type == "number") and .locationIndex >= 0)
            ));
        def text_ok: type == "string" and length > 0;
        ((.demoAccounting.tariffs // []) | type == "array" and
        all(
            (.definition.name | startswith("DEMO — ")) and
            (.definition.sourceReference | startswith("Synthetic simulator ")) and
            assignments_ok
        )) and
        ((.demoAccounting.emissionFactors // []) | type == "array" and
        all(
            (.sourceReference | startswith("Synthetic simulator ")) and
            (.revision | not) and
            (.id | not)
        )) and
        ((.accounting.tariffs // []) | type == "array" and
        all(
            (.definition.name | text_ok) and
            (.definition.sourceReference | text_ok) and
            assignments_ok
        )) and
        ((.accounting.emissionFactors // []) | type == "array" and
        all(
            (.sourceReference | text_ok) and
            (.revision | not) and
            (.id | not)
        ))
    ' "$fixture" >/dev/null; then
        error "Profile ${FM_SEED_PROFILE} has invalid accounting data."
        return 1
    fi
}

_seed_fixture_tariffs() {
    local fixture="$1" block="$2"
    local existing entry definition name tariff_id method response rpc_error
    local assignment scope_level location_index body
    existing=$(_seed_rpc 'Tariff.List' '{}')
    rpc_error=$(jq -r '.error.message // empty' <<<"$existing")
    if [ -n "$rpc_error" ]; then
        error "Fixture demo tariffs could not be listed: $rpc_error"
        return 1
    fi

    while IFS= read -r entry; do
        [ -n "$entry" ] || continue
        definition=$(jq -c '.definition' <<<"$entry")
        name=$(jq -r '.name' <<<"$definition")
        tariff_id=$(jq -r --arg name "$name" \
            '(.items[]? | select(.name == $name) | .id) // empty' \
            <<<"$existing" | head -n1)
        if [ -n "$tariff_id" ]; then
            method='Update'
            body=$(jq -c --argjson id "$tariff_id" '. + {id:$id}' \
                <<<"$definition")
        else
            method='Add'
            body="$definition"
        fi
        response=$(_seed_rpc "Tariff.$method" "$body")
        rpc_error=$(jq -r '.error.message // empty' <<<"$response")
        tariff_id=$(jq -r '.id // empty' <<<"$response")
        if [ -n "$rpc_error" ] || ! [[ "$tariff_id" =~ ^[1-9][0-9]*$ ]]; then
            error "Fixture demo tariff $name could not be saved: ${rpc_error:-invalid response}"
            return 1
        fi

        while IFS= read -r assignment; do
            [ -n "$assignment" ] || continue
            scope_level=$(jq -r '.scopeLevel' <<<"$assignment")
            if [ "$scope_level" = 'location' ]; then
                location_index=$(jq -r '.locationIndex' <<<"$assignment")
                if [ "$location_index" -ge "${#SEED_BUILDING_IDS[@]}" ]; then
                    error "Fixture demo tariff $name references missing location index $location_index."
                    return 1
                fi
                body=$(jq -cn --argjson tariffId "$tariff_id" \
                    --argjson locationId "${SEED_BUILDING_IDS[$location_index]}" \
                    '{tariffId:$tariffId,scopeLevel:"location",locationId:$locationId,direction:"import"}')
            else
                body=$(jq -cn --argjson tariffId "$tariff_id" \
                    '{tariffId:$tariffId,scopeLevel:"organization",direction:"import"}')
            fi
            response=$(_seed_rpc 'Tariff.Assign' "$body")
            rpc_error=$(jq -r '.error.message // empty' <<<"$response")
            if [ -n "$rpc_error" ] || [ "$(jq -r '.ok // false' <<<"$response")" != true ]; then
                error "Fixture demo tariff $name could not be assigned: ${rpc_error:-invalid response}"
                return 1
            fi
        done < <(jq -c '.assignments[]' <<<"$entry")
    done < <(jq -c --arg block "$block" '.[$block].tariffs[]?' "$fixture")
}

_seed_fixture_emission_factors() {
    local fixture="$1" block="$2" params='{"limit":100}' existing='[]'
    local response rpc_error next_before desired latest body
    while true; do
        response=$(_seed_rpc 'carbon.ListEmissionFactors' "$params")
        rpc_error=$(jq -r '.error.message // empty' <<<"$response")
        if [ -n "$rpc_error" ]; then
            error "Fixture demo emission factors could not be listed: $rpc_error"
            return 1
        fi
        existing=$(jq -cn --argjson prior "$existing" --argjson page "$response" \
            '$prior + ($page.items // [])')
        next_before=$(jq -r '.nextBeforeId // empty' <<<"$response")
        [ -n "$next_before" ] || break
        params=$(jq -cn --argjson beforeId "$next_before" \
            '{limit:100,beforeId:$beforeId}')
    done

    while IFS= read -r desired; do
        [ -n "$desired" ] || continue
        latest=$(jq -c --argjson desired "$desired" '
            [ .[] | select(
                .commodity == $desired.commodity and
                .billedUnit == $desired.billedUnit and
                .region == $desired.region and
                .accountingBasis == $desired.accountingBasis and
                .emissionsScope == $desired.emissionsScope and
                .effectiveFrom == $desired.effectiveFrom and
                .sourceReference == $desired.sourceReference
            ) ] | sort_by(.revision) | last // null
        ' <<<"$existing")
        if jq -e --argjson desired "$desired" '
            . != null and
            .factorKgPerUnit == $desired.factorKgPerUnit and
            (.effectiveTo // null) == ($desired.effectiveTo // null)
        ' <<<"$latest" >/dev/null; then
            continue
        fi
        body=$(jq -c 'del(.id, .revision)' <<<"$desired")
        response=$(_seed_rpc 'carbon.AddEmissionFactor' "$body")
        rpc_error=$(jq -r '.error.message // empty' <<<"$response")
        if [ -n "$rpc_error" ] || ! jq -e '.factor.id | type == "number" and . > 0' \
            <<<"$response" >/dev/null; then
            error "Fixture demo emission factor could not be saved: ${rpc_error:-invalid response}"
            return 1
        fi
    done < <(jq -c --arg block "$block" '.[$block].emissionFactors[]?' "$fixture")
}

_seed_fixture_accounting() {
    local fixture block
    fixture=$(_seed_accounting_fixture) || return 0
    _seed_fixture_accounting_validate "$fixture" || return 1
    for block in demoAccounting accounting; do
        jq -e --arg block "$block" '.[$block] | type == "object"' "$fixture" \
            >/dev/null 2>&1 || continue
        _seed_fixture_tariffs "$fixture" "$block" || return 1
        _seed_fixture_emission_factors "$fixture" "$block" || return 1
    done
    ok "Fixture-owned accounting configuration applied."
}
