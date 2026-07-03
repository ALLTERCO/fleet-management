#!/usr/bin/env bash

base64url_encode() {
    openssl base64 -A | tr '+/' '-_' | tr -d '='
}

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

    local header
    header=$(printf '{"alg":"RS256","kid":"%s"}' "$key_id" | base64url_encode)

    local payload
    payload=$(printf '{"iss":"%s","sub":"%s","aud":"%s","iat":%d,"exp":%d}' \
        "$user_id" "$user_id" "$audience" "$now" "$exp" | base64url_encode)

    local signature
    signature=$(printf '%s.%s' "$header" "$payload" | \
        openssl dgst -sha256 -sign <(printf '%s' "$pem_key") | base64url_encode)

    printf '%s.%s.%s' "$header" "$payload" "$signature"
}

system_jwt_sign() {
    local private_key_path="$1"
    local system_user="$2"
    local audience="$3"

    local now exp
    now=$(date +%s)
    exp=$((now + 3600))

    local header
    header=$(printf '{"alg":"RS256"}' | base64url_encode)

    local payload
    payload=$(printf '{"iss":"%s","sub":"%s","aud":"%s","iat":%d,"exp":%d}' \
        "$system_user" "$system_user" "$audience" "$now" "$exp" | base64url_encode)

    local signature
    signature=$(printf '%s.%s' "$header" "$payload" | \
        openssl dgst -sha256 -sign "$private_key_path" | base64url_encode)

    printf '%s.%s.%s' "$header" "$payload" "$signature"
}
