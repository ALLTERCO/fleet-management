#!/usr/bin/env bash
# Demo root CA imported into the certificate store.

set -euo pipefail

_seed_certificates() {
    info "Seeding demo CA certificate..."
    local pem
    pem=$(_seed_generate_demo_ca_pem)
    [ -z "$pem" ] && {
        info "  skipped (openssl missing or generation failed)"
        return 0
    }
    _seed_import_certificate 'Demo Seed CA' 'root_ca' "$pem"
}

_seed_generate_demo_ca_pem() {
    local tmp pem
    tmp=$(mktemp -d) || return 0
    if openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "$tmp/ca.key" -out "$tmp/ca.crt" \
        -days 30 -subj '/CN=Demo Seed CA' 2>/dev/null; then
        pem=$(jq -Rs . <"$tmp/ca.crt")
    fi
    rm -rf "$tmp"
    echo "$pem"
}

_seed_import_certificate() {
    local name="$1" kind="$2" pem_json="$3" body
    body=$(jq -nc --arg n "$name" --arg k "$kind" --argjson pem "$pem_json" '
        {name:$n, kind:$k, pem:$pem, tags:["demo"]}
    ')
    if _seed_rpc 'Certificate.Import' "$body" >/dev/null 2>&1; then
        info "  $name"
    else
        info "  $name — skipped (RPC unavailable or duplicate)"
    fi
}
