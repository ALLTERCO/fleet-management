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
    local devices seeded requested blu items body response count seeded_count
    local max_items candidate_count
    local lead_widgets lead_count entity_max entity_items entity_count
    local first_meter_shelly first_meter_sub first_meter_entity meter_power_field
    local first_load_entity
    # The one dashboard cap (tuning.dashboard.maxItems); SetAll rejects a batch
    # above it. Same default as the backend's envInt fallback.
    max_items="${FM_DASHBOARD_MAX_ITEMS:-200}"
    # An env file can leak an inline comment into the value (compose env_file
    # does not strip them); keep only the leading integer so the arithmetic
    # below (max_items - lead_count) does not choke on the trailing text.
    max_items="${max_items%%[!0-9]*}"
    max_items="${max_items:-200}"
    devices=$(_seed_rpc 'Device.List' '{"limit":0}')
    requested="${FM_SEED_DEVICE_IDS_JSON:-[]}"
    blu="${FM_SEED_BLU_DEVICE_IDS_JSON:-[]}"
    seeded=$(jq -c \
        --argjson requested "$requested" \
        --argjson blu "$blu" '
            [.items[]?
             | select(
                 (.shellyID as $id | $requested | index($id)) or
                 (.shellyID as $id | $blu | index($id)) or
                 ((.source // "") | startswith("demo-seed-"))
               )
             | select(.seed_active != false)
             | {id, shellyID, entities: (.entities // [])}]
            | unique_by(.id)
            | sort_by(.shellyID)
        ' <<<"$devices")
    first_meter_shelly=$(jq -r '
        [.[] | select(any(.entities[]?;
            test("^(em|em1|pm1):") or test(":(em|em1|pm1)$")
        ))]
        | .[0].shellyID // ""
    ' <<<"$seeded")
    first_meter_sub=$(jq -r --arg shelly "$first_meter_shelly" '
        .[]
        | select(.shellyID == $shelly)
        | [.entities[]? | select(
            test("^(em|em1|pm1):") or test(":(em|em1|pm1)$")
        )][0] // ""
    ' <<<"$seeded")
    first_meter_entity=$(jq -r \
        --arg shelly "$first_meter_shelly" \
        --arg sub "$first_meter_sub" '
        def known_types: ["em","em1","pm1"];
        .[]
        | select(.shellyID == $shelly)
        | ($sub | split(":")) as $parts
        | if known_types | index($parts[0])
          then "\(.id)_\($parts[1]):\($parts[0])"
          else "\(.id)_\($parts[0]):\($parts[1])"
          end
    ' <<<"$seeded")
    meter_power_field=$(case "$first_meter_sub" in
        em:*|*:em) echo "total_act_power" ;;
        *) echo "act_power" ;;
    esac)
    first_load_entity=$(jq -r '
        def entity_id($device; $sub):
            ($sub | split(":")) as $parts
            | if $parts[0] == "switch"
              then "\($device.id)_\($parts[1]):switch"
              else "\($device.id)_\($parts[0]):switch"
              end;
        first(
            .[] as $device
            | $device.entities[]?
            | select(test("^switch:") or test(":switch$"))
            | entity_id($device; .)
        ) // ""
    ' <<<"$seeded")
    # Fleet-wide widgets lead the board. Meter charts are added only when a
    # seeded meter can supply real data.
    lead_widgets=$(jq -cn \
        --arg meter "$first_meter_shelly" \
        --arg meterSub "$first_meter_sub" \
        --arg meterEntity "$first_meter_entity" \
        --arg powerField "$meter_power_field" \
        --arg loadEntity "$first_load_entity" '
        [
          {"kind":"widget","widgetKind":"fleet_kpi_strip_widget","widgetConfig":{},"size":"2x1"},
          {"kind":"widget","widgetKind":"site_grid_widget","widgetConfig":{"metric":"power"},"size":"2x2"},
          {"kind":"widget","widgetKind":"cross_site_bar_widget","widgetConfig":{"metric":"live_power","limit":8},"size":"2x1"},
          {"kind":"widget","widgetKind":"maintenance_list_widget","widgetConfig":{"severities":["critical","warning","info"],"maxItems":8},"size":"2x1"},
          {"kind":"widget","widgetKind":"data_table_widget","widgetConfig":{"source":"device_health","sortBy":"name","maxRows":12},"size":"2x2"},
          {"kind":"widget","widgetKind":"clock_widget","widgetConfig":{},"size":"1x1"}
        ]
        + if $meter == "" then [] else [
          {"kind":"widget","widgetKind":"chart_widget","widgetConfig":{"shellyId":$meter,"metric":"power","chartType":"line","range":"24h"},"size":"2x1"},
          {"kind":"widget","widgetKind":"activity_heatmap_widget","widgetConfig":{"shellyId":$meter,"metric":"power","days":7},"size":"2x2"},
          {"kind":"widget","widgetKind":"gauge_widget","widgetConfig":{"entityId":$meterEntity,"field":$powerField,"label":"Live meter power","unit":"W","min":0,"max":5000,"thresholds":[{"value":3500,"color":"#f59e0b"},{"value":4500,"color":"#ef4444"}]},"size":"1x1"},
          {"kind":"widget","widgetKind":"stats_summary_widget","widgetConfig":{"entries":[{"shellyId":$meter,"metric":"power","name":"Power"},{"shellyId":$meter,"metric":"voltage","name":"Voltage"}],"range":"24h"},"size":"2x1"},
          {"kind":"widget","widgetKind":"top_consumers_widget","widgetConfig":{"entityIds":[$meterEntity],"range":"24h","limit":5},"size":"2x1"},
          {"kind":"widget","widgetKind":"state_timeline_widget","widgetConfig":{"entities":[{"shellyId":$meter,"field":"\($meterSub).\($powerField)","name":"Meter power"}],"range":"24h"},"size":"2x2"},
          {"kind":"widget","widgetKind":"energy_flow_sankey_widget","widgetConfig":{"sources":[{"entityId":$meterEntity,"label":"Grid"}],"loads":(if $loadEntity == "" then [] else [{"entityId":$loadEntity,"label":"Load"}] end),"showValues":true},"size":"2x2"}
        ] end
    ')
    lead_count=$(jq 'length' <<<"$lead_widgets")
    entity_max=$((max_items - lead_count))
    entity_items=$(jq -c --argjson max "$entity_max" '
            def known_types:
                ["switch","light","cover","thermostat","blutrv","rgb",
                 "rgbw","rgbcct","cct","cb","cury","media","camera",
                 "em","em1","pm1","emdata","em1data","temperature",
                 "humidity","illuminance","flood","smoke","occupancy",
                 "presence","voltmeter","bthomesensor","input","button",
                 "devicepower","service","ui","matter","schedule",
                 "bthomedevice","camerazone","presencezone"];
            def entity_type:
                split(":") as $parts
                | if known_types | index($parts[0])
                  then $parts[0]
                  else $parts[-1]
                  end;
            # One widget per entity, sized by how much the component shows.
            def card_size($type):
                if ["em","em1","emdata","em1data","blutrv","thermostat",
                    "camera","cury","cb","rgbcct","media"] | index($type)
                then "2x2"
                elif ["pm1","cover","light","rgb","rgbw","cct","switch",
                      "presence","occupancy"] | index($type) then "2x1"
                else "1x1" end;
            # What the device is for comes first, not entity id order.
            def card_rank($type):
                if ["switch","light","cover","thermostat","blutrv","rgb",
                    "rgbw","rgbcct","cct","cb","cury","media","camera",
                    "em","em1","pm1"] | index($type) then 0
                elif ["emdata","em1data","temperature","humidity",
                      "illuminance","flood","smoke","occupancy","presence",
                      "voltmeter","bthomesensor"] | index($type) then 1
                elif ["input","button","devicepower"] | index($type) then 2
                else 3 end;
            # Components nobody operates or reads; they render as blank widgets.
            def card_hidden($type):
                ["service","ui","matter","schedule","bthomedevice",
                 "camerazone","presencezone"] | index($type) != null;
            # One sample per device of the types that repeat identically.
            def thin_repeats:
                reduce .[] as $e ({seen: {}, keep: []};
                    ($e | entity_type) as $t
                    | if ["input","button","bthomesensor"] | index($t)
                      then if .seen[$t] then .
                           else {seen: (.seen + {($t): true}),
                                 keep: (.keep + [$e])} end
                      else {seen: .seen, keep: (.keep + [$e])} end)
                | .keep;
            map(. as $d
                | $d.entities
                | map(select(card_hidden(. | entity_type) | not))
                | thin_repeats
                # entity_sub_id is VARCHAR(50); a longer key resolves to nothing.
                | map(select(length <= 50))
                | map({deviceId: $d.id, shellyID: $d.shellyID, sub: .,
                       rank: card_rank(. | entity_type)}))
            | flatten
            # Rank first so every device keeps its primary component at the cap.
            | sort_by(.rank, .shellyID, .sub)
            | .[0:$max]
            | sort_by(.shellyID, .rank, .sub)
            | to_entries
            | map({
                kind:"entity",
                deviceId:.value.deviceId,
                entitySubId:.value.sub,
                order:.key,
                size: card_size(.value.sub | entity_type)
              })
        ' <<<"$seeded")
    items=$(jq -c --argjson lead "$lead_widgets" --argjson entities "$entity_items" '
            $lead + ($entities | map(del(.order)))
            | to_entries | map(.value + {order: .key})
        ' <<<'null')
    count=$(jq 'length' <<<"$items")
    entity_count=$(jq 'length' <<<"$entity_items")
    seeded_count=$(jq 'length' <<<"$seeded")
    # Never cap silently: say how many components did not make the board.
    candidate_count=$(jq '[.[].entities[]?] | length' <<<"$seeded")
    if [ "$candidate_count" -gt "$entity_count" ]; then
        info "  $((candidate_count - entity_count)) component(s) omitted: dashboard holds at most $max_items cards, $lead_count reserved for fleet widgets (least important dropped first)."
    fi
    # SetAll replaces the board, so an empty list would wipe it.
    if [ "$count" -eq 0 ] && [ "$seeded_count" -ne 0 ]; then
        error "Seeded devices report no controllable entities; refusing to clear dashboard $dashboard_id"
        return 1
    fi
    body=$(jq -cn --argjson dashboard "$dashboard_id" --argjson items "$items" \
        '{dashboardId:$dashboard,items:$items}')
    response=$(_seed_rpc 'Dashboard.Item.SetAll' "$body")
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
