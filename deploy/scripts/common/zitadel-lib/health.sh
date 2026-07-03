#!/usr/bin/env bash

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
        http_code=$(curl -s --connect-timeout 5 --max-time 5 -o /dev/null -w '%{http_code}' \
            -X POST "${url}/oauth/v2/token" \
            "${extra_headers[@]}" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -d "grant_type=client_credentials&client_id=probe&client_secret=probe" 2>/dev/null || echo "000")
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

# Probe management API — HTTP can answer before internal gRPC binds.
# 401/400/200 = wired; 5xx/no response = gRPC still mid-start.
zitadel_wait_management_ready() {
    local url="$1"
    local host_header="${2:-}"
    local timeout="${3:-60}"
    local elapsed=0

    local -a extra_headers=()
    if [ -n "$host_header" ]; then
        extra_headers=(-H "Host: ${host_header}")
    fi

    echo "Waiting for Zitadel management API readiness..."
    while [ "$elapsed" -lt "$timeout" ]; do
        local http_code
        http_code=$(curl -s --connect-timeout 5 --max-time 5 -o /dev/null -w '%{http_code}' \
            -X POST "${url}/v2/organizations/_search" \
            "${extra_headers[@]}" \
            -H "Content-Type: application/json" \
            -d '{"query":{"limit":1}}' 2>/dev/null || echo "000")
        if [ "$http_code" != "000" ] && [ "${http_code:0:1}" != "5" ]; then
            echo "Management API ready (${elapsed}s, HTTP $http_code)"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        if [ $((elapsed % 10)) -eq 0 ]; then
            echo "  Management API not ready yet... (${elapsed}s / ${timeout}s, HTTP $http_code)"
        fi
    done

    echo "WARNING: Management API still returning 5xx after ${timeout}s" >&2
    return 1
}

wait_for_machinekey() {
    local path="$1"
    local timeout="${2:-120}"
    local elapsed=0

    echo "Waiting for machinekey at ${path}..."
    while [ "$elapsed" -lt "$timeout" ]; do
        if [ -f "$path" ] && [ -s "$path" ]; then
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
