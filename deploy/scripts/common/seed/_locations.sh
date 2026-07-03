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
    local data count i row name id
    data=$(_seed_offices_data)
    count=$(echo "$data" | jq 'length')
    i=0
    while [ "$i" -lt "$count" ]; do
        row=$(echo "$data" | jq -c ".[$i]")
        name=$(echo "$row" | jq -r '.buildingName')
        id=$(_seed_find_building_id_by_name "$name")
        [ -n "$id" ] && SEED_BUILDING_IDS+=("$id")
        i=$((i + 1))
    done
}

_seed_find_building_id_by_name() {
    local name="$1" payload
    payload=$(_seed_rpc 'Location.List' '{"limit":500}')
    echo "$payload" | jq -r --arg n "$name" \
        '.items[]? | select(.name == $n and .kind == "building") | .id' \
        | head -n1
}

_seed_one_office() {
    local row="$1"
    local country cc city site building address_json lat lng
    country=$(echo "$row" | jq -r '.country')
    cc=$(echo "$row" | jq -r '.countryCode')
    city=$(echo "$row" | jq -r '.city')
    site=$(echo "$row" | jq -r '.siteName // (.buildingName + " Site")')
    building=$(echo "$row" | jq -r '.buildingName')
    # Address already shaped to the backend's per-kind schema.
    address_json=$(echo "$row" | jq -c '.address')
    lat=$(echo "$row" | jq -r '.geo.lat')
    lng=$(echo "$row" | jq -r '.geo.lng')

    # countryCode lives on the country row only; city + building schemas
    # reject it as additionalProperties (it is inherited at read time).
    local country_geo city_geo country_id city_id site_id building_id
    country_geo=$(_seed_resolve_geo "$country" "$cc")
    city_geo=$(_seed_resolve_geo "$city" "$cc")
    country_id=$(_seed_create_location "$country" 'country' 'null' \
        "$(_seed_kind_fields_with_geo "{\"countryCode\":\"$cc\"}" "$country_geo")")
    city_id=$(_seed_create_location "$city" 'city' "$country_id" \
        "$(_seed_kind_fields_with_geo '{}' "$city_geo")")
    site_id=$(_seed_create_location "$site" 'site' "$city_id" \
        "{\"address\":$address_json,\"geo\":{\"lat\":$lat,\"lng\":$lng}}")
    building_id=$(_seed_create_location "$building" 'building' "$site_id" \
        "{\"address\":$address_json,\"geo\":{\"lat\":$lat,\"lng\":$lng}}")
    info "  $building (id=$building_id)"
    SEED_BUILDING_IDS+=("$building_id")
}

_seed_create_location() {
    local name="$1" kind="$2" parent="$3" kind_fields="$4"
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
        '{name:$name,kind:$kind,parentLocationId:$parent,kindFields:$kf}')
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
    payload=$(_seed_rpc 'Location.List' '{"limit":500}')
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
    for kind in building site city country; do
        i=0
        while [ "$i" -lt "$count" ]; do
            row=$(echo "$data" | jq -c ".[$i]")
            case "$kind" in
                building) name=$(echo "$row" | jq -r '.buildingName') ;;
                site) name=$(echo "$row" | jq -r '.siteName // (.buildingName + " Site")') ;;
                city) name=$(echo "$row" | jq -r '.city') ;;
                country) name=$(echo "$row" | jq -r '.country') ;;
            esac
            _seed_delete_locations_by_name_kind "$name" "$kind"
            i=$((i + 1))
        done
    done
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
