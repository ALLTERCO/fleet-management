#!/usr/bin/env bash
# Office hierarchies — country → city → site → building.
# Optionally overridable from deploy/seed/offices.json.

set -euo pipefail

# Reads office definitions from deploy/seed/offices.json if present, else
# falls back to the bundled defaults. Each entry: {country, countryCode,
# city, siteName?, buildingName, address: {streetNumber?, streetName,
# city, postalCode, countryCode}, geo: {lat, lng}}.
_seed_offices_data() {
    local override="$DEPLOY_DIR/seed/offices.json"
    if [ -f "$override" ]; then
        cat "$override"
        return
    fi
    # A template's own fixture owns its location tree, the same rule
    # dev-server.sh already applies to the simulator config. Without this every
    # new template needs a branch below, which is how a template ends up seeded
    # with another market's cities.
    local profile_fixture="$DEPLOY_DIR/seed/${FM_SEED_PROFILE:-}.json"
    if [ -n "${FM_SEED_PROFILE:-}" ] && [ -f "$profile_fixture" ] \
        && jq -e '.locations | type == "array" and length > 0' "$profile_fixture" >/dev/null 2>&1; then
        jq -c '.locations' "$profile_fixture"
        return
    fi
    if [ "${FM_SEED_PROFILE:-}" = "aussie-grocers" ]; then
        local fixture="$DEPLOY_DIR/seed/aussie-grocers.json"
        [ -f "$fixture" ] || {
            error "Aussie Grocers fixture is missing: $fixture"
            return 1
        }
        jq -c '
            . as $root
            | [.stores[]
                | . as $store
                | ($root.cities[$store.city]) as $city
                | {
                    country: $root.country.name,
                    countryCode: $root.country.code,
                    countryKindFields: {
                        countryCode: $root.country.code,
                        currency: $root.country.currency,
                        timezone: $root.country.timezone
                    },
                    region: $store.state,
                    regionCode: ($root.country.code + "-" + $store.stateCode),
                    city: $store.city,
                    siteName: $store.name,
                    buildingName: ($store.name + " Building"),
                    address: $store.address,
                    geo: $store.geo,
                    # Fixture coordinates for the levels above the store. Used
                    # only when the geonames place lookup is unavailable, which
                    # otherwise leaves country/region/city rows unpositioned.
                    countryGeo: ($root.country.geo // null),
                    regionGeo: ($root.regions[$store.state].geo // null),
                    cityGeo: ($city.geo // null),
                    siteKindFields: {
                        siteType: (($store.format | ascii_downcase | gsub(" "; "_"))),
                        timezone: $city.timezone
                    },
                    customFields: {
                        locationType: "store",
                        storeCode: $store.code,
                        storeFormat: $store.format,
                        storeContext: $store.context,
                        geoCity: $store.city,
                        geoState: $store.state,
                        geoCountry: $root.country.name,
                        geoCountryCode: $root.country.code,
                        geoPostcode: $store.address.postalCode,
                        geoLat: $store.geo.lat,
                        geoLng: $store.geo.lng,
                        areaM2: $store.areaM2,
                        climate: $city.climate,
                        loadProfile: $city.loadProfile,
                        # Network identity is descriptive. Billing prices are
                        # stored only in Fleet tariffs and meter assignments.
                        electricityNetwork: ($store.network // $city.network),
                        electricityNetworkConfidence: ($store.networkConfidence // null),
                        # Copied onto every store rather than retained as a
                        # simulator-only assumption. The template can now
                        # distinguish ordinary movement from after-hours
                        # movement in the store-local timezone.
                        tradingOpenHour: (($store.tradingHours // $root.tradingHours).openHour),
                        tradingCloseHour: (($store.tradingHours // $root.tradingHours).closeHour)
                    }
                }
            ]
        ' "$fixture"
        return
    fi
    # A Business Manager fixture may supply its own location catalog. No
    # fixture is registered in the public build, so this falls through.
    local _bm_catalog
    if _bm_catalog="$(bm_demo_catalog)"; then
        printf '%s\n' "$_bm_catalog"
        return
    fi
    cat <<'JSON'
[
    {
        "country": "Bulgaria", "countryCode": "BG",
        "city": "Sofia",
        "buildingName": "Shelly Group SE (HQ)",
        "address": {"streetNumber": "51", "streetName": "Cherni Vrah Blvd (building 3, floors 2-3)", "city": "Sofia", "postalCode": "1407", "countryCode": "BG"},
        "geo": {"lat": 42.65803, "lng": 23.31799}
    },
    {
        "country": "Germany", "countryCode": "DE",
        "city": "Munich",
        "buildingName": "Allterco GmbH",
        "address": {"streetNumber": "41", "streetName": "St.-Cajetan-Str.", "city": "Munich", "postalCode": "81669", "countryCode": "DE"},
        "geo": {"lat": 48.12083, "lng": 11.60228}
    },
    {
        "country": "United States", "countryCode": "US",
        "city": "Boca Raton",
        "buildingName": "Shelly USA (East)",
        "address": {"streetNumber": "980", "streetName": "N Federal Hwy (Suite 430)", "city": "Boca Raton", "postalCode": "33432", "countryCode": "US"},
        "geo": {"lat": 26.35985, "lng": -80.08376}
    },
    {
        "country": "United States", "countryCode": "US",
        "city": "Las Vegas",
        "buildingName": "Shelly USA (West)",
        "address": {"streetNumber": "10161", "streetName": "Park Run Dr (Suite 160)", "city": "Las Vegas", "postalCode": "89145", "countryCode": "US"},
        "geo": {"lat": 36.16092, "lng": -115.31696}
    },
    {
        "country": "China", "countryCode": "CN",
        "city": "Shenzhen",
        "buildingName": "Shelly China",
        "address": {"streetNumber": "4168", "streetName": "Liuxian Ave, Nanshan (Zhongguan Times Square Block A 2006/2007)", "city": "Shenzhen", "postalCode": "518055", "countryCode": "CN"},
        "geo": {"lat": 22.5979, "lng": 113.9486}
    },
    {
        "country": "Slovenia", "countryCode": "SI",
        "city": "Solkan",
        "buildingName": "Shelly Slovenia",
        "address": {"streetNumber": "7", "streetName": "Ulica Klementa Juga", "city": "Solkan", "postalCode": "5250", "countryCode": "SI"},
        "geo": {"lat": 45.96667, "lng": 13.64265}
    },
    {
        "country": "Poland", "countryCode": "PL",
        "city": "Szeligi",
        "buildingName": "Shelly Poland Sp. z o.o.",
        "address": {"streetNumber": "2", "streetName": "ul. Bukowa", "city": "Szeligi", "postalCode": "05-850", "countryCode": "PL"},
        "geo": {"lat": 52.22532, "lng": 20.86908}
    },
    {
        "country": "Slovakia", "countryCode": "SK",
        "city": "Bratislava",
        "buildingName": "Allterco Slovakia",
        "address": {"city": "Bratislava", "postalCode": "81101", "countryCode": "SK"},
        "geo": {"lat": 48.1486, "lng": 17.1077}
    }
]
JSON
}

_seed_offices() {
    local data count i
    data=$(_seed_offices_data)
    count=$(echo "$data" | jq 'length')
    info "Creating $count office hierarchies..."
    SEED_BUILDING_IDS=()
    i=0
    while [ "$i" -lt "$count" ]; do
        _seed_one_office "$(echo "$data" | jq -c ".[$i]")"
        i=$((i + 1))
    done
}

# Re-derive SEED_BUILDING_IDS from Location.List when create phase was
# skipped (idempotent re-run). Order matches the office data so the
# floorplan still lands on the first row (Sofia HQ).
_seed_load_building_ids() {
    SEED_BUILDING_IDS=()
    local data count i row name site_name id
    data=$(_seed_offices_data)
    count=$(echo "$data" | jq 'length')
    i=0
    while [ "$i" -lt "$count" ]; do
        row=$(echo "$data" | jq -c ".[$i]")
        name=$(echo "$row" | jq -r '.buildingName')
        site_name=$(echo "$row" | jq -r '.siteName // (.buildingName + " Site")')
        id=$(_seed_find_building_id_by_name "$name" "$site_name")
        [ -n "$id" ] && SEED_BUILDING_IDS+=("$id")
        i=$((i + 1))
    done
}

# A fixture with one estate and one building has no distribution decision to
# make: every simulator device belongs to that building. Multi-location
# fixtures must keep an explicit profile-owned assignment plan because only the
# fixture knows how their hardware is distributed.
_seed_assign_single_location_fixture_devices() {
    local requested="${FM_SEED_DEVICE_IDS_JSON:-[]}" profile_fixture
    [ "$(jq 'length' <<<"$requested")" -gt 0 ] || return 0
    [ -n "${FM_SEED_PROFILE:-}" ] || return 0
    profile_fixture="$DEPLOY_DIR/seed/${FM_SEED_PROFILE}.json"
    [ -f "$profile_fixture" ] || return 0
    jq -e '.locations | type == "array" and length == 1' \
        "$profile_fixture" >/dev/null 2>&1 || return 0

    if [ "${#SEED_BUILDING_IDS[@]}" -ne 1 ]; then
        error "Profile ${FM_SEED_PROFILE} defines one location, but its single building could not be resolved."
        return 1
    fi

    local subjects body response expected assigned
    subjects=$(jq -c '
        unique
        | map({subjectType:"device",subjectId:.})
    ' <<<"$requested")
    body=$(jq -cn \
        --argjson locationId "${SEED_BUILDING_IDS[0]}" \
        --argjson subjects "$subjects" \
        '{locationId:$locationId,subjects:$subjects}')
    response=$(_seed_rpc 'Location.SetAssignments' "$body")
    expected=$(jq 'length' <<<"$subjects")
    assigned=$(jq -r '.assigned | if type == "array" then length else -1 end' \
        <<<"$response" 2>/dev/null || printf '%s' -1)
    if [ "$assigned" -ne "$expected" ]; then
        error "Single-location device assignment failed: $response"
        return 1
    fi
    ok "Assigned $assigned simulator devices to the single seeded building."
}

# A fixture may classify selected simulator profiles through Fleet's canonical
# device-assignment RPC. Profiles absent from the map retain their location
# membership without being guessed into an energy or appliance category.
_seed_configure_fixture_device_assignments() {
    local requested="${FM_SEED_DEVICE_IDS_JSON:-[]}" fixture profiles_json
    [ "$(jq 'length' <<<"$requested")" -gt 0 ] || return 0
    [ -n "${FM_SEED_PROFILE:-}" ] || return 0
    fixture="$DEPLOY_DIR/seed/${FM_SEED_PROFILE}.json"
    [ -f "$fixture" ] || return 0
    jq -e '.simulator.deviceAssignmentProfiles | type == "object"' \
        "$fixture" >/dev/null 2>&1 || return 0

    profiles_json=$(_seed_fixture_simulator_profiles_json "$fixture")
    if [ "$(jq 'length' <<<"$profiles_json")" -eq 0 ]; then
        error "Profile ${FM_SEED_PROFILE} declares device assignment profiles, but no simulator profile order is available."
        return 1
    fi

    local count index shelly_id profile profile_count mapping location_index
    local body response rpc_error expected_keys
    count=$(jq 'length' <<<"$requested")
    profile_count=$(jq 'length' <<<"$profiles_json")
    index=0
    while [ "$index" -lt "$count" ]; do
        shelly_id=$(jq -r --argjson index "$index" '.[$index]' <<<"$requested")
        profile=$(jq -r --argjson index "$((index % profile_count))" \
            '.[$index]' <<<"$profiles_json")
        mapping=$(jq -c --arg profile "$profile" \
            '.simulator.deviceAssignmentProfiles[$profile] // null' "$fixture")
        if [ "$mapping" != null ]; then
            location_index=$(jq -r '.locationIndex' <<<"$mapping")
            if ! [[ "$location_index" =~ ^[0-9]+$ ]] || \
               [ "$location_index" -ge "${#SEED_BUILDING_IDS[@]}" ]; then
                error "Profile $profile references missing location index $location_index."
                return 1
            fi
            body=$(jq -cn --argjson locationId "${SEED_BUILDING_IDS[$location_index]}" \
                --arg shellyID "$shelly_id" --argjson mapping "$mapping" \
                '{locationId:$locationId,shellyID:$shellyID,selectedEntityKeys:$mapping.selectedEntityKeys,catalogKind:$mapping.catalogKind}')
            response=$(_seed_rpc 'Location.ConfigureDeviceAssignment' "$body")
            rpc_error=$(jq -r '.error.message // empty' <<<"$response")
            expected_keys=$(jq -c '.selectedEntityKeys | sort' <<<"$mapping")
            if [ -n "$rpc_error" ] || \
               [ "$(jq -r '.shellyID // empty' <<<"$response")" != "$shelly_id" ] || \
               [ "$(jq -r '.catalogKind // empty' <<<"$response")" != "$(jq -r '.catalogKind' <<<"$mapping")" ] || \
               [ "$(jq -c '.selectedEntityKeys | sort' <<<"$response")" != "$expected_keys" ]; then
                error "Simulator assignment profile for $shelly_id could not be configured: ${rpc_error:-invalid response}"
                return 1
            fi
        fi
        index=$((index + 1))
    done
    ok "Configured Fleet catalog roles for fixture-owned simulator profiles."
}

_seed_assign_fixture_device_locations() {
    local requested="${FM_SEED_DEVICE_IDS_JSON:-[]}" fixture profiles_json plan
    [ "$(jq 'length' <<<"$requested")" -gt 0 ] || return 0
    [ -n "${FM_SEED_PROFILE:-}" ] || return 0
    fixture="$DEPLOY_DIR/seed/${FM_SEED_PROFILE}.json"
    [ -f "$fixture" ] || return 0
    jq -e '.simulator.deviceLocationProfiles | type == "object"' \
        "$fixture" >/dev/null 2>&1 || return 0

    profiles_json=$(_seed_fixture_simulator_profiles_json "$fixture")
    if [ "$(jq 'length' <<<"$requested")" -ne "$(jq 'length' <<<"$profiles_json")" ]; then
        error "Profile ${FM_SEED_PROFILE} device ids do not match its simulator profile order."
        return 1
    fi
    plan=$(jq -c '.simulator.deviceLocationProfiles' "$fixture")

    local assignments
    assignments=$(jq -cn \
        --argjson devices "$requested" \
        --argjson profiles "$profiles_json" \
        --argjson plan "$plan" '
        reduce range(0; $devices | length) as $index
            ({counts:{}, items:[]};
             ($profiles[$index]) as $profile
             | (.counts[$profile] // 0) as $occurrence
             | .counts[$profile] = ($occurrence + 1)
             | ($plan[$profile] // null) as $locations
             | if $locations == null then .
               else .items += [{
                   subjectType:"device",
                   subjectId:$devices[$index],
                   profile:$profile,
                   occurrence:$occurrence,
                   locationIndex:$locations[$occurrence]
               }] end)
        | .items
    ')
    if jq -e 'any(.locationIndex == null)' <<<"$assignments" >/dev/null; then
        error "Profile ${FM_SEED_PROFILE} device-location plan is shorter than its simulator inventory."
        return 1
    fi

    local location_index subjects body response expected assigned
    while IFS= read -r location_index; do
        [ -n "$location_index" ] || continue
        if ! [[ "$location_index" =~ ^[0-9]+$ ]] || \
           [ "$location_index" -ge "${#SEED_BUILDING_IDS[@]}" ]; then
            error "Profile ${FM_SEED_PROFILE} references missing location index $location_index."
            return 1
        fi
        subjects=$(jq -c --argjson index "$location_index" '
            [.[] | select(.locationIndex == $index) | {subjectType,subjectId}]
        ' <<<"$assignments")
        body=$(jq -cn \
            --argjson locationId "${SEED_BUILDING_IDS[$location_index]}" \
            --argjson subjects "$subjects" \
            '{locationId:$locationId,subjects:$subjects}')
        response=$(_seed_rpc 'Location.SetAssignments' "$body")
        expected=$(jq 'length' <<<"$subjects")
        assigned=$(jq -r '.assigned | if type == "array" then length else -1 end' \
            <<<"$response" 2>/dev/null || printf '%s' -1)
        if [ "$assigned" -ne "$expected" ]; then
            error "Fixture device-location assignment failed: $response"
            return 1
        fi
    done < <(jq -r '[.[].locationIndex] | unique[]' <<<"$assignments")
    ok "Assigned fixture-owned simulator devices to declared locations."
}

_seed_find_building_id_by_name() {
    local name="$1" site_name="$2" payload
    payload=$(_seed_rpc 'Location.List' '{"limit":1000}')
    echo "$payload" | jq -r --arg name "$name" --arg site "$site_name" '
        .items as $items
        | ($items[]? | select(.kind == "site" and .name == $site) | .id) as $siteId
        | $items[]?
        | select(
            .kind == "building"
            and .name == $name
            and .parentLocationId == $siteId
        )
        | .id
    ' | head -n1
}

_seed_one_office() {
    local row="$1"
    local country cc region region_code city site building address_json custom_fields lat lng
    country=$(echo "$row" | jq -r '.country')
    cc=$(echo "$row" | jq -r '.countryCode')
    region=$(echo "$row" | jq -r '.region // empty')
    region_code=$(echo "$row" | jq -r '.regionCode // empty')
    city=$(echo "$row" | jq -r '.city')
    site=$(echo "$row" | jq -r '.siteName // (.buildingName + " Site")')
    building=$(echo "$row" | jq -r '.buildingName')
    # Address already shaped to the backend's per-kind schema.
    address_json=$(echo "$row" | jq -c '.address')
    custom_fields=$(echo "$row" | jq -c '.customFields // {}')
    lat=$(echo "$row" | jq -r '.geo.lat')
    lng=$(echo "$row" | jq -r '.geo.lng')

    # countryCode lives on the country row only; city + building schemas
    # reject it as additionalProperties (it is inherited at read time).
    local country_geo region_geo city_geo country_id region_id city_parent city_id site_id building_id
    country_geo=$(_seed_fixture_geo_fallback \
        "$(_seed_resolve_geo "$country" "$cc")" "$row" countryGeo)
    region_geo=$(_seed_fixture_geo_fallback \
        "$(_seed_resolve_geo "$region" "$cc")" "$row" regionGeo)
    city_geo=$(_seed_fixture_geo_fallback \
        "$(_seed_resolve_geo "$city" "$cc")" "$row" cityGeo)
    local country_fields site_fields building_fields
    country_fields=$(echo "$row" | jq -c '.countryKindFields // {countryCode:.countryCode}')
    site_fields=$(echo "$row" | jq -c '.siteKindFields // {}')
    # A building's category (buildingType) is a kind field, like the site's.
    building_fields=$(echo "$row" | jq -c '.buildingKindFields // {}')
    country_id=$(_seed_create_location "$country" 'country' 'null' \
        "$(_seed_kind_fields_with_geo "$country_fields" "$country_geo")")
    city_parent="$country_id"
    if [ -n "$region" ]; then
        region_id=$(_seed_create_location "$region" 'region' "$country_id" \
            "$(_seed_kind_fields_with_geo "$(jq -cn --arg code "$region_code" '{regionCode:$code}')" "$region_geo")")
        city_parent="$region_id"
    fi
    city_id=$(_seed_create_location "$city" 'city' "$city_parent" \
        "$(_seed_kind_fields_with_geo '{}' "$city_geo")")
    site_id=$(_seed_create_location "$site" 'site' "$city_id" \
        "$(jq -cn --argjson base "$site_fields" --argjson address "$address_json" \
            --argjson lat "$lat" --argjson lng "$lng" \
            '$base + {address:$address,geo:{lat:$lat,lng:$lng}}')" \
        "$custom_fields")
    building_id=$(_seed_create_location "$building" 'building' "$site_id" \
        "$(jq -cn --argjson base "$building_fields" --argjson address "$address_json" \
            --argjson lat "$lat" --argjson lng "$lng" \
            '$base + {address:$address,geo:{lat:$lat,lng:$lng}}')" \
        "$custom_fields")
    info "  $building (id=$building_id)"
    SEED_BUILDING_IDS+=("$building_id")
}

_seed_create_location() {
    local name="$1" kind="$2" parent="$3" kind_fields="$4"
    local custom_fields="${5:-}"
    [ -n "$custom_fields" ] || custom_fields='{}'
    # Empty parent (from a failed previous call) crashes --argjson silently.
    [ -z "$parent" ] && parent='null'
    local existing
    existing=$(_seed_find_location_id "$name" "$kind" "$parent")
    if [ -n "$existing" ]; then
        echo "$existing"
        return 0
    fi
    local body resp id
    body=$(jq -cn \
        --arg name "$name" --arg kind "$kind" \
        --argjson parent "$parent" --argjson kf "$kind_fields" \
        --argjson cf "$custom_fields" \
        '{name:$name,kind:$kind,parentLocationId:$parent,kindFields:$kf,customFields:$cf}')
    resp=$(_seed_rpc 'Location.Create' "$body")
    id=$(echo "$resp" | jq -r '.id // empty')
    if [ -z "$id" ]; then
        echo "[seed] Location.Create($kind/$name) failed: $resp" >&2
        return 1
    fi
    echo "$id"
}

_seed_find_location_id() {
    local name="$1" kind="$2" parent="$3"
    local payload
    payload=$(_seed_rpc 'Location.List' '{"limit":1000}')
    if [ "$parent" = 'null' ]; then
        echo "$payload" | jq -r --arg n "$name" --arg k "$kind" \
            '.items[]? | select(.name == $n and .kind == $k and (.parentLocationId == null)) | .id' \
            | head -n1
    else
        echo "$payload" | jq -r --arg n "$name" --arg k "$kind" --argjson p "$parent" \
            '.items[]? | select(.name == $n and .kind == $k and .parentLocationId == $p) | .id' \
            | head -n1
    fi
}

# Keep a resolved geo blob, else fall back to the fixture's own coordinates for
# that level. Without this a stack with no geonames data leaves every country,
# region and city unpositioned — the store pins render, their parents do not.
_seed_fixture_geo_fallback() {
    local resolved="$1" row="$2" field="$3"
    if [ -n "$resolved" ]; then
        echo "$resolved"
        return
    fi
    jq -c --arg field "$field" '
        (.[$field] // empty) | select(. != null) | {lat, lng, source: "imported"}
    ' <<<"$row"
}

# Merge a resolved geo blob into a kindFields JSON object. Empty geo passes
# the base fields through untouched so legacy / unmatched rows still seed.
_seed_kind_fields_with_geo() {
    local base="$1" geo="$2"
    if [ -z "$geo" ]; then
        echo "$base"
        return
    fi
    jq -c --argjson g "$geo" '. + {geo:$g}' <<<"$base"
}

# Resolve {lat,lng,name,geonameid} for a place via Location.SearchPlaces.
_seed_resolve_geo() {
    local query="$1" cc="$2"
    local body resp
    body=$(jq -cn --arg q "$query" --arg cc "$cc" \
        '{query:$q,biasCountryCode:$cc,limit:1}')
    resp=$(_seed_rpc 'Location.SearchPlaces' "$body")
    # Enrichment only. If SearchPlaces is unavailable (e.g. geonames data not
    # loaded), the response may not be JSON — return empty so the caller falls
    # back to the seed's static coordinates instead of aborting the whole seed.
    if ! printf '%s' "$resp" | jq -e . >/dev/null 2>&1; then
        return 0
    fi
    echo "$resp" | jq -c --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
        (.candidates[0] // empty) as $c
        | if $c == null then empty
          else {
              lat: $c.lat,
              lng: $c.lng,
              source: "autocomplete",
              matchedName: $c.name,
              geonameid: ($c.geonameid // null),
              verifiedAt: $now
          } | with_entries(select(.value != null))
          end
    '
}

_seed_reset_locations() {
    local data count i row name
    data=$(_seed_offices_data)
    count=$(echo "$data" | jq 'length')
    for kind in building site city region country; do
        i=0
        while [ "$i" -lt "$count" ]; do
            row=$(echo "$data" | jq -c ".[$i]")
            case "$kind" in
                building) name=$(echo "$row" | jq -r '.buildingName') ;;
                site) name=$(echo "$row" | jq -r '.siteName // (.buildingName + " Site")') ;;
                city) name=$(echo "$row" | jq -r '.city') ;;
                region) name=$(echo "$row" | jq -r '.region // empty') ;;
                country) name=$(echo "$row" | jq -r '.country') ;;
            esac
            [ -z "$name" ] && { i=$((i + 1)); continue; }
            _seed_delete_locations_by_name_kind "$name" "$kind"
            i=$((i + 1))
        done
    done
    # A fixture may need to clear rows an earlier catalog left behind.
    bm_demo_run reset_legacy
}

_seed_delete_locations_by_name_kind() {
    local name="$1" kind="$2" payload ids
    payload=$(_seed_rpc 'Location.List' '{}')
    ids=$(echo "$payload" | jq -r \
        --arg name "$name" --arg kind "$kind" \
        '.items[]? | select(.name == $name and .kind == $kind) | .id')
    for id in $ids; do
        _seed_rpc 'Location.Delete' "{\"id\":$id}" >/dev/null
    done
}

# Uploads deploy/seed/example-floorplan.svg to the Sofia HQ building.
_seed_attach_floorplan() {
    local svg_file="$DEPLOY_DIR/seed/example-floorplan.svg"
    if [ ! -f "$svg_file" ]; then
        info "  No deploy/seed/example-floorplan.svg — skipping floorplan upload."
        return 0
    fi
    local sofia_id="${SEED_BUILDING_IDS[0]:-}"
    if [ -z "$sofia_id" ]; then
        info "  No Sofia building id — skipping floorplan upload."
        return 0
    fi
    info "Uploading floorplan to Sofia HQ (id=$sofia_id)..."
    local ticket
    ticket=$(_seed_mint_floorplan_ticket "$sofia_id")
    if [ -z "$ticket" ]; then
        info "  Could not mint upload ticket — skipping."
        return 0
    fi
    _seed_post_floorplan "$sofia_id" "$ticket" "$svg_file"
}

_seed_mint_floorplan_ticket() {
    local sofia_id="$1" resp
    resp=$(_seed_rpc 'Location.FloorPlan.CreateUploadTicket' \
        "{\"locationId\":$sofia_id}")
    echo "$resp" | jq -r '.uploadTicket // empty'
}

_seed_post_floorplan() {
    local sofia_id="$1" ticket="$2" svg_file="$3"
    # Upload endpoint: Bearer = caller's auth token, ticket = form field.
    local upload_resp plan_url plan_w plan_h update_body update_resp
    upload_resp=$(curl -sk \
        -X POST "$FM_BASE_URL/api/uploads/floor-plan" \
        -H "Authorization: Bearer $FM_SEED_TOKEN" \
        -F "locationId=$sofia_id" \
        -F "ticket=$ticket" \
        -F "file=@$svg_file;type=image/svg+xml")
    plan_url=$(echo "$upload_resp" | jq -r '.url // empty')
    plan_w=$(echo "$upload_resp" | jq -r '.widthPx // empty')
    plan_h=$(echo "$upload_resp" | jq -r '.heightPx // empty')
    if [ -z "$plan_url" ] || [ -z "$plan_w" ] || [ -z "$plan_h" ]; then
        info "  Floorplan upload did not return url+dims: $upload_resp"
        return 0
    fi
    # The upload route stops at writing the file — persist the URL onto
    # the building's kindFields.floorPlan so it actually renders.
    update_body=$(jq -cn \
        --argjson id "$sofia_id" \
        --arg url "$plan_url" \
        --argjson w "$plan_w" \
        --argjson h "$plan_h" \
        '{id:$id, kindFields:{floorPlan:{url:$url, widthPx:$w, heightPx:$h}}}')
    update_resp=$(_seed_rpc 'Location.Update' "$update_body")
    if echo "$update_resp" | jq -e '.id // empty' >/dev/null 2>&1; then
        info "  Floorplan attached to Sofia HQ (${plan_w}×${plan_h})."
    else
        info "  Floorplan upload OK but Location.Update failed: $update_resp"
    fi
}
