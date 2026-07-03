#!/usr/bin/env bash

zitadel_host_header_scheme() {
    if [ "${ZITADEL_EXTERNALSECURE:-false}" = "true" ]; then
        printf 'https'
    else
        printf 'http'
    fi
}

zitadel_external_audience() {
    local fallback_url="$1"
    local jwt_audience="$fallback_url"

    if [ -n "${ZITADEL_HOST_HEADER:-}" ]; then
        local scheme host_part
        scheme=$(zitadel_host_header_scheme)
        host_part="${ZITADEL_HOST_HEADER}"
        [ "$scheme" = "https" ] && host_part="${host_part%:443}"
        [ "$scheme" = "http" ] && host_part="${host_part%:80}"
        jwt_audience="${scheme}://${host_part}"
    fi

    printf '%s' "$jwt_audience"
}

zitadel_get_token() {
    local machinekey_path="$1"
    local zitadel_url="$2"

    local jwt_audience
    jwt_audience="$(zitadel_external_audience "$zitadel_url")"

    local jwt
    jwt=$(zitadel_jwt_sign "$machinekey_path" "$jwt_audience")

    local curl_args=(
        -sS
        --fail-with-body
        --connect-timeout "${ZITADEL_CURL_CONNECT_TIMEOUT_SECONDS:-10}"
        --max-time "${ZITADEL_CURL_MAX_TIME_SECONDS:-30}"
        -X POST
    )
    [ "${CURL_INSECURE:-}" = true ] && curl_args+=(-k)
    if [ -n "${ZITADEL_HOST_HEADER:-}" ]; then
        curl_args+=(-H "Host: ${ZITADEL_HOST_HEADER}")
    fi
    curl_args+=(
        -H "Content-Type: application/x-www-form-urlencoded"
        -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer"
        -d "scope=openid urn:zitadel:iam:org:project:id:zitadel:aud"
        -d "assertion=${jwt}"
    )

    local response
    response=$(curl "${curl_args[@]}" "${zitadel_url}/oauth/v2/token")

    local token
    token=$(echo "$response" | jq -r '.access_token // empty')
    if [ -z "$token" ]; then
        echo "ERROR: Failed to get access token" >&2
        echo "$response" >&2
        return 1
    fi

    printf '%s' "$token"
}

zitadel_api() {
    local method="$1"
    local path="$2"
    local body="$3"
    local token="$4"
    local zitadel_url="$5"

    local curl_args=(
        -sS
        --connect-timeout "${ZITADEL_CURL_CONNECT_TIMEOUT_SECONDS:-10}"
        --max-time "${ZITADEL_CURL_MAX_TIME_SECONDS:-30}"
        -X "$method"
        -H "Authorization: Bearer ${token}"
        -H "Content-Type: application/json"
    )
    [ "${CURL_INSECURE:-}" = true ] && curl_args+=(-k)
    if [[ "$path" == /zitadel.* ]]; then
        curl_args+=(-H "Connect-Protocol-Version: 1")
    fi

    if [ -n "${ZITADEL_HOST_HEADER:-}" ]; then
        curl_args+=(-H "Host: ${ZITADEL_HOST_HEADER}")
    fi

    if [ -n "${ZITADEL_ORG_HEADER:-}" ]; then
        curl_args+=(-H "x-zitadel-orgid: ${ZITADEL_ORG_HEADER}")
    fi

    if [ -n "$body" ] && [ "$body" != "null" ]; then
        curl_args+=(-d "$body")
    fi

    curl "${curl_args[@]}" "${zitadel_url}${path}"
}
