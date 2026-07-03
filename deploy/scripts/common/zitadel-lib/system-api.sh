#!/usr/bin/env bash

system_api_add_instance_domain() {
    local zitadel_url="$1"
    local system_key_path="$2"
    local domain="$3"
    local system_user="system-user-1"

    local jwt_audience
    jwt_audience="$(zitadel_external_audience "$zitadel_url")"

    local jwt
    jwt=$(system_jwt_sign "$system_key_path" "$system_user" "$jwt_audience")

    local common_args=(-sS)
    if [ -n "${ZITADEL_HOST_HEADER:-}" ]; then
        common_args+=(-H "Host: ${ZITADEL_HOST_HEADER}")
    fi
    common_args+=(
        -H "Authorization: Bearer ${jwt}"
        -H "Content-Type: application/json"
        -H "Connect-Protocol-Version: 1"
    )

    local instances_response
    instances_response=$(curl "${common_args[@]}" \
        -X POST "${zitadel_url}/zitadel.instance.v2.InstanceService/ListInstances" \
        -d '{"pagination":{"limit":1}}')

    local instance_id
    instance_id=$(echo "$instances_response" | jq -r '(.instances // [])[0].id // empty')

    if [ -z "$instance_id" ]; then
        echo "ERROR: Could not find Zitadel instance" >&2
        echo "  Response: $instances_response" >&2
        return 1
    fi

    local domains_request
    domains_request=$(jq -cn --arg instanceId "$instance_id" '{instanceId:$instanceId}')
    local domains_response
    domains_response=$(curl "${common_args[@]}" \
        -X POST "${zitadel_url}/zitadel.instance.v2.InstanceService/ListCustomDomains" \
        -d "$domains_request")

    if echo "$domains_response" | jq -e --arg domain "$domain" \
        '(.domains // [])[] | select(.domain == $domain)' >/dev/null 2>&1; then
        echo "  Domain '$domain' already registered on instance $instance_id"
        return 0
    fi

    local add_request
    add_request=$(jq -cn \
        --arg instanceId "$instance_id" \
        --arg customDomain "$domain" \
        '{instanceId:$instanceId,customDomain:$customDomain}')
    local add_response http_code body
    add_response=$(curl "${common_args[@]}" -w "\n%{http_code}" \
        -X POST "${zitadel_url}/zitadel.instance.v2.InstanceService/AddCustomDomain" \
        -d "$add_request")
    http_code=$(echo "$add_response" | tail -1)
    body=$(echo "$add_response" | sed '$d')

    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        echo "  Domain '$domain' added to instance $instance_id"
        return 0
    fi
    if [ "$http_code" = "409" ] || \
       echo "$body" | jq -e '(.message // "") | contains("already exists")' >/dev/null 2>&1; then
        echo "  Domain '$domain' already exists"
        return 0
    fi
    echo "ERROR: Failed to add domain '$domain' (HTTP $http_code)" >&2
    echo "  Response: $body" >&2
    return 1
}
