#!/usr/bin/env bash
# Demo dashboards + waiting-room widget attach.

set -euo pipefail

_seed_dashboards() {
    info "Reconciling dashboards..."
    local spec key name type enabled id
    while IFS= read -r spec; do
        key=$(jq -r '.key' <<<"$spec")
        name=$(jq -r '.name' <<<"$spec")
        type=$(jq -r '.type' <<<"$spec")
        enabled=$(jq -r '.enabled' <<<"$spec")
        if [ "$enabled" = "true" ]; then
            if [ "$key" = "control" ]; then
                id=$(_seed_ensure_control_dashboard)
                SEED_CONTROL_DASHBOARD_ID="$id"
            else
                id=$(_seed_ensure_dashboard "$name" "$type")
            fi
        else
            _seed_delete_dashboards_matching "$name" "$type"
        fi
    done < <(_seed_dashboard_catalog | jq -c '.[]')
}

_seed_ensure_control_dashboard() {
    local response default_id control_ids id duplicate update
    response=$(_seed_rpc 'Dashboard.List' '{}')
    default_id=$(jq -r '
        [.items[]? | select(.name == "Default Dashboard" and .dashboardType == "classic")]
        | sort_by(.id) | .[0].id // empty
    ' <<<"$response")
    control_ids=$(jq -r '
        [.items[]? | select(.name == "Device Control" and .dashboardType == "classic")]
        | sort_by(.id) | .[].id
    ' <<<"$response")

    if [ -n "$default_id" ]; then
        while IFS= read -r duplicate; do
            [ -z "$duplicate" ] && continue
            _seed_delete_dashboard "$duplicate"
        done <<<"$control_ids"
        update=$(_seed_rpc 'Dashboard.Update' \
            "{\"id\":$default_id,\"name\":\"Device Control\",\"dashboardType\":\"classic\"}")
        if ! jq -e --argjson id "$default_id" '
            .id == $id and .name == "Device Control" and .dashboardType == "classic"
        ' <<<"$update" >/dev/null; then
            error "Failed to rename default dashboard $default_id: $update"
            return 1
        fi
        id="$default_id"
    else
        id=$(head -1 <<<"$control_ids")
        if [ -z "$id" ]; then
            id=$(_seed_ensure_dashboard 'Device Control' 'classic')
        else
            while IFS= read -r duplicate; do
                if [ -z "$duplicate" ] || [ "$duplicate" = "$id" ]; then
                    continue
                fi
                _seed_delete_dashboard "$duplicate"
            done <<<"$control_ids"
        fi
    fi
    info "  Device Control (id=$id, type=classic)" >&2
    echo "$id"
}

_seed_dashboard_catalog() {
    printf '%s\n' '[
      {"key":"energy","name":"Energy Overview","type":"energy","enabled":true},
      {"key":"control","name":"Device Control","type":"classic","enabled":true},
      {"key":"legacy-office-classic","name":"Office Status","type":"classic","enabled":false},
      {"key":"legacy-office-overview","name":"Office Status","type":"overview","enabled":false},
      {"key":"legacy-map","name":"Sites Map","type":"map","enabled":false}
    ]'
}

_seed_ensure_dashboard() {
    local name="$1" type="$2" response ids id duplicate body
    response=$(_seed_rpc 'Dashboard.List' '{}')
    ids=$(jq -r --arg name "$name" --arg type "$type" '
        [.items[]? | select(.name == $name and .dashboardType == $type)]
        | sort_by(.id) | .[].id
    ' <<<"$response")
    id=$(head -1 <<<"$ids")
    if [ -z "$id" ]; then
        body=$(jq -cn --arg name "$name" --arg type "$type" \
            '{name:$name,dashboardType:$type}')
        response=$(_seed_rpc 'Dashboard.Create' "$body")
        id=$(jq -r '.id // empty' <<<"$response")
        if [ -z "$id" ]; then
            error "Failed to create dashboard $name: $response"
            return 1
        fi
    else
        while IFS= read -r duplicate; do
            if [ -z "$duplicate" ] || [ "$duplicate" = "$id" ]; then
                continue
            fi
            _seed_delete_dashboard "$duplicate"
        done <<<"$ids"
    fi
    info "  $name (id=$id, type=$type)" >&2
    echo "$id"
}

_seed_delete_dashboards_matching() {
    local name="$1" type="$2" response id
    response=$(_seed_rpc 'Dashboard.List' '{}')
    while IFS= read -r id; do
        [ -z "$id" ] && continue
        _seed_delete_dashboard "$id"
    done < <(jq -r --arg name "$name" --arg type "$type" '
        .items[]? | select(.name == $name and .dashboardType == $type) | .id
    ' <<<"$response")
}

_seed_delete_dashboard() {
    local id="$1" response
    response=$(_seed_rpc 'Dashboard.Delete' "{\"id\":$id}")
    if ! jq -e --argjson id "$id" '.deleted == $id' <<<"$response" >/dev/null; then
        error "Failed to delete seeded dashboard $id: $response"
        return 1
    fi
}

_seed_delete_managed_dashboards() {
    local spec name type
    while IFS= read -r spec; do
        name=$(jq -r '.name' <<<"$spec")
        type=$(jq -r '.type' <<<"$spec")
        _seed_delete_dashboards_matching "$name" "$type"
    done < <(_seed_dashboard_catalog | jq -c '.[]')
}

_seed_accept_waiting_room_devices() {
    info "Checking waiting room for pending devices..."
    local pending_resp pending_count requested_json accept_ids
    pending_resp=$(_seed_rpc 'WaitingRoom.List' '{"limit":500,"state":"open"}')
    pending_count=$(echo "$pending_resp" | jq '.total // 0' 2>/dev/null \
        || echo 0)
    if [ "$pending_count" = "0" ] || [ -z "$pending_count" ]; then
        info "  No pending devices."
        return 0
    fi

    requested_json="${FM_SEED_DEVICE_IDS_JSON:-}"
    if [ -z "$requested_json" ]; then
        info "  No simulator inventory supplied; pending devices were not changed."
        return 0
    fi
    accept_ids=$(echo "$pending_resp" | jq -c \
        --argjson requested "$requested_json" '
            [.items[]?.shellyID] as $pending
            | [$requested[] | select(. as $id | $pending | index($id))]
        ')

    local accept_count accept_resp failed_count
    accept_count=$(echo "$accept_ids" | jq 'length')
    if [ "$accept_count" = "0" ]; then
        info "  No requested devices are pending."
        return 0
    fi
    info "  Accepting $accept_count pending device(s)..."
    accept_resp=$(_seed_rpc 'WaitingRoom.AcceptPendingByExternalId' \
        "{\"externalIds\":$accept_ids}")
    failed_count=$(echo "$accept_resp" | jq '
        if (.error | type) == "array" then (.error | length)
        elif .error then -1
        else 0
        end
    ' 2>/dev/null || echo -1)
    if [ "$failed_count" != "0" ]; then
        error "Failed to accept all requested devices: $accept_resp"
        return 1
    fi
}

_seed_reconcile_control_dashboard() {
    local dashboard_id
    dashboard_id=$(_seed_resolve_control_dashboard_id)
    if [ -z "$dashboard_id" ]; then
        info "  Device Control dashboard not found — skipping card reconciliation."
        return 0
    fi
    info "Reconciling seeded device cards on dashboard $dashboard_id..."
    local devices requested blu items body response count
    devices=$(_seed_rpc 'Device.List' '{"limit":0}')
    requested="${FM_SEED_DEVICE_IDS_JSON:-[]}"
    blu="${FM_SEED_BLU_DEVICE_IDS_JSON:-[]}"
    items=$(jq -c \
        --argjson requested "$requested" \
        --argjson blu "$blu" '
            [.items[]?
             | select(
                 (.shellyID as $id | $requested | index($id)) or
                 (.shellyID as $id | $blu | index($id)) or
                 ((.source // "") | startswith("demo-seed-"))
               )
             | select(.seed_active != false)
             | {id, shellyID}]
            | unique_by(.id)
            | sort_by(.shellyID)
            | to_entries
            | map({
                kind:"device",
                deviceId:.value.id,
                order:.key,
                size:(if (.key % 3) == 0 then "1x1"
                      elif (.key % 3) == 1 then "2x1"
                      else "2x2" end)
              })
        ' <<<"$devices")
    body=$(jq -cn --argjson dashboard "$dashboard_id" --argjson items "$items" \
        '{dashboardId:$dashboard,items:$items}')
    response=$(_seed_rpc 'Dashboard.Item.SetAll' "$body")
    count=$(jq 'length' <<<"$items")
    if ! jq -e --argjson count "$count" \
        '(.error == null) and ((.items | length) == $count)' \
        <<<"$response" >/dev/null 2>&1; then
        error "Failed to reconcile Device Control cards: $response"
        return 1
    fi
    info "  Device Control now contains $count seeded device card(s)."
}

_seed_resolve_control_dashboard_id() {
    local id="${SEED_CONTROL_DASHBOARD_ID:-}"
    [ -n "$id" ] && {
        echo "$id"
        return
    }
    _seed_rpc 'Dashboard.List' '{}' \
        | jq -r '.items[]? | select(.name=="Device Control" and .dashboardType=="classic") | .id' \
        | head -1
}
