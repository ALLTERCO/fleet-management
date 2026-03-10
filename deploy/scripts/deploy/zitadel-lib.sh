#!/usr/bin/env bash
#
# Zitadel API library — JWT signing, token exchange, API helpers
#
# Usage: source this file from bootstrap-zitadel.sh
#
# Requires: openssl, jq, curl
#
# Reference: tools/zitadel/zitadel-bootstrap/src/helpers.ts

# --- Base64url encode (stdin → stdout, no padding) ---
base64url_encode() {
    openssl base64 -A | tr '+/' '-_' | tr -d '='
}

# --- Sign RS256 JWT from Zitadel machinekey JSON ---
# Usage: zitadel_jwt_sign <machinekey_json_path> <audience_url>
# Output: signed JWT string on stdout
zitadel_jwt_sign() {
    local machinekey_path="$1"
    local audience="$2"

    local key_id user_id pem_key
    key_id=$(jq -r '.keyId' "$machinekey_path")
    user_id=$(jq -r '.userId' "$machinekey_path")
    pem_key=$(jq -r '.key' "$machinekey_path")

    local now exp
    now=$(date +%s)
    exp=$((now + 3600))

    # JWT header
    local header
    header=$(printf '{"alg":"RS256","kid":"%s"}' "$key_id" | base64url_encode)

    # JWT payload
    local payload
    payload=$(printf '{"iss":"%s","sub":"%s","aud":"%s","iat":%d,"exp":%d}' \
        "$user_id" "$user_id" "$audience" "$now" "$exp" | base64url_encode)

    # Sign with RSA-SHA256
    local signature
    signature=$(printf '%s.%s' "$header" "$payload" | \
        openssl dgst -sha256 -sign <(printf '%s' "$pem_key") | base64url_encode)

    printf '%s.%s.%s' "$header" "$payload" "$signature"
}

# --- Exchange JWT for access token ---
# Usage: zitadel_get_token <machinekey_json_path> <zitadel_url>
# Output: access_token string on stdout
# Env: ZITADEL_HOST_HEADER — if set, passed as Host header (for NAT hairpin workaround)
zitadel_get_token() {
    local machinekey_path="$1"
    local zitadel_url="$2"

    # JWT audience must use the public hostname for Zitadel to accept it
    local jwt_audience="$zitadel_url"
    if [ -n "${ZITADEL_HOST_HEADER:-}" ]; then
        jwt_audience="http://${ZITADEL_HOST_HEADER}"
    fi

    local jwt
    jwt=$(zitadel_jwt_sign "$machinekey_path" "$jwt_audience")

    local curl_args=(-sS --fail-with-body -X POST)
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

# --- Zitadel Management API call ---
# Usage: zitadel_api <method> <path> <body> <token> <zitadel_url>
# Output: JSON response on stdout
# Env: ZITADEL_HOST_HEADER — if set, passed as Host header (for NAT hairpin workaround)
zitadel_api() {
    local method="$1"
    local path="$2"
    local body="$3"
    local token="$4"
    local zitadel_url="$5"

    local curl_args=(
        -sS
        -X "$method"
        -H "Authorization: Bearer ${token}"
        -H "Content-Type: application/json"
    )

    if [ -n "${ZITADEL_HOST_HEADER:-}" ]; then
        curl_args+=(-H "Host: ${ZITADEL_HOST_HEADER}")
    fi

    if [ -n "$body" ] && [ "$body" != "null" ]; then
        curl_args+=(-d "$body")
    fi

    curl "${curl_args[@]}" "${zitadel_url}${path}"
}

# --- Wait for Zitadel to be healthy ---
# Usage: zitadel_wait_healthy <url> [timeout_seconds]
zitadel_wait_healthy() {
    local url="$1"
    local timeout="${2:-120}"
    local elapsed=0

    echo "Waiting for Zitadel at ${url} to become healthy..."
    while [ "$elapsed" -lt "$timeout" ]; do
        if curl -sf "${url}/debug/ready" >/dev/null 2>&1; then
            echo "Zitadel is healthy (${elapsed}s)"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        if [ $((elapsed % 10)) -eq 0 ]; then
            echo "  Still waiting... (${elapsed}s / ${timeout}s)"
        fi
    done

    echo "ERROR: Zitadel did not become healthy within ${timeout}s" >&2
    return 1
}

# --- Wait for Zitadel token endpoint to accept requests ---
# /debug/ready passes before OIDC endpoints are fully initialized.
# This probe sends a dummy token request WITH the correct Host header
# and waits until Zitadel returns a non-500 response.
# Usage: zitadel_wait_token_ready <url> [host_header] [timeout_seconds]
zitadel_wait_token_ready() {
    local url="$1"
    local host_header="${2:-}"
    local timeout="${3:-60}"
    local elapsed=0

    local -a extra_headers=()
    if [ -n "$host_header" ]; then
        extra_headers=(-H "Host: ${host_header}")
    fi

    echo "Waiting for Zitadel token endpoint readiness (Host: ${host_header:-<default>})..."
    while [ "$elapsed" -lt "$timeout" ]; do
        local http_code
        http_code=$(curl -s -o /dev/null -w '%{http_code}' \
            -X POST "${url}/oauth/v2/token" \
            "${extra_headers[@]}" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -d "grant_type=client_credentials&client_id=probe&client_secret=probe" 2>/dev/null || echo "000")
        # Any non-5xx response means the endpoint is ready
        if [ "$http_code" != "000" ] && [ "${http_code:0:1}" != "5" ]; then
            echo "Token endpoint ready (${elapsed}s, HTTP $http_code)"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        if [ $((elapsed % 10)) -eq 0 ]; then
            echo "  Token endpoint not ready yet... (${elapsed}s / ${timeout}s, HTTP $http_code)"
        fi
    done

    echo "WARNING: Token endpoint still returning 5xx after ${timeout}s" >&2
    return 1
}

# --- Wait for machinekey file to appear ---
# Usage: wait_for_machinekey <path> [timeout_seconds]
wait_for_machinekey() {
    local path="$1"
    local timeout="${2:-120}"
    local elapsed=0

    echo "Waiting for machinekey at ${path}..."
    while [ "$elapsed" -lt "$timeout" ]; do
        if [ -f "$path" ] && [ -s "$path" ]; then
            # Validate it's valid JSON with required fields
            if jq -e '.keyId and .userId and .key' "$path" >/dev/null 2>&1; then
                echo "Machinekey found (${elapsed}s)"
                return 0
            fi
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done

    echo "ERROR: Machinekey not found at ${path} within ${timeout}s" >&2
    return 1
}

# =====================================================================
# System API — for managing instance domains (custom domains)
# =====================================================================
#
# The System API is a superordinate API that operates above all instances.
# It uses a separate RSA keypair (not the machinekey) for authentication.
# We use it to register the Docker-internal hostname so containers
# can communicate with Zitadel without going through the external IP.

# --- Sign RS256 JWT for Zitadel System API user ---
# Usage: system_jwt_sign <private_key_path> <system_user_name> <audience_url>
# Output: signed JWT string on stdout
system_jwt_sign() {
    local private_key_path="$1"
    local system_user="$2"
    local audience="$3"

    local now exp
    now=$(date +%s)
    exp=$((now + 3600))

    # JWT header (no kid for system API)
    local header
    header=$(printf '{"alg":"RS256"}' | base64url_encode)

    # JWT payload — iss and sub are the system user name
    local payload
    payload=$(printf '{"iss":"%s","sub":"%s","aud":"%s","iat":%d,"exp":%d}' \
        "$system_user" "$system_user" "$audience" "$now" "$exp" | base64url_encode)

    # Sign with RSA-SHA256
    local signature
    signature=$(printf '%s.%s' "$header" "$payload" | \
        openssl dgst -sha256 -sign "$private_key_path" | base64url_encode)

    printf '%s.%s.%s' "$header" "$payload" "$signature"
}

# --- Add custom domain to a Zitadel instance via System API ---
# Usage: system_api_add_instance_domain <zitadel_url> <system_key_path> <domain>
# Returns 0 on success or if domain already exists
# Env: ZITADEL_HOST_HEADER — if set, passed as Host header (for NAT hairpin workaround)
system_api_add_instance_domain() {
    local zitadel_url="$1"
    local system_key_path="$2"
    local domain="$3"
    local system_user="system-user-1"

    # JWT audience must use the public hostname for Zitadel to accept it
    local jwt_audience="$zitadel_url"
    if [ -n "${ZITADEL_HOST_HEADER:-}" ]; then
        jwt_audience="http://${ZITADEL_HOST_HEADER}"
    fi

    # Generate system API JWT
    local jwt
    jwt=$(system_jwt_sign "$system_key_path" "$system_user" "$jwt_audience")

    # Build common curl args with optional Host header
    local common_args=(-sS)
    if [ -n "${ZITADEL_HOST_HEADER:-}" ]; then
        common_args+=(-H "Host: ${ZITADEL_HOST_HEADER}")
    fi
    common_args+=(-H "Authorization: Bearer ${jwt}" -H "Content-Type: application/json")

    # Find the instance ID (first instance)
    local instances_response
    instances_response=$(curl "${common_args[@]}" \
        -X POST "${zitadel_url}/system/v1/instances/_search" \
        -d '{"limit":1}')

    local instance_id
    instance_id=$(echo "$instances_response" | jq -r '(.result // []) | .[0].id // empty')

    if [ -z "$instance_id" ]; then
        echo "ERROR: Could not find Zitadel instance" >&2
        echo "  Response: $instances_response" >&2
        return 1
    fi

    # Check if domain already exists
    local domains_response
    domains_response=$(curl "${common_args[@]}" \
        -X POST "${zitadel_url}/system/v1/instances/${instance_id}/domains/_search" \
        -d '{}')

    if echo "$domains_response" | jq -e ".result[]? | select(.domain == \"$domain\")" >/dev/null 2>&1; then
        echo "  Domain '$domain' already registered on instance $instance_id"
        return 0
    fi

    # Add the domain
    local add_response
    add_response=$(curl "${common_args[@]}" -w "\n%{http_code}" \
        -X POST "${zitadel_url}/system/v1/instances/${instance_id}/domains" \
        -d "{\"domain\":\"${domain}\"}")

    local http_code
    http_code=$(echo "$add_response" | tail -1)
    local body
    body=$(echo "$add_response" | sed '$d')

    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        echo "  Domain '$domain' added to instance $instance_id"
        return 0
    elif [ "$http_code" = "409" ]; then
        echo "  Domain '$domain' already exists (409)"
        return 0
    else
        echo "ERROR: Failed to add domain '$domain' (HTTP $http_code)" >&2
        echo "  Response: $body" >&2
        return 1
    fi
}
