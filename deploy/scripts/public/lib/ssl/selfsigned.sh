# shellcheck shell=bash
# Self-signed TLS certificate generation.

generate_selfsigned_cert() {
    local hostname="$1"
    local tls_dir="$STATE_DIR/tls"
    local dyn_dir="$tls_dir/dynamic"
    mkdir -p "$dyn_dir"

    if [ -f "$tls_dir/server.crt" ] && [ -f "$tls_dir/server.key" ]; then
        if is_ip_address "$hostname"; then
            if openssl x509 -in "$tls_dir/server.crt" -checkip "$hostname" -noout >/dev/null 2>&1; then
                write_traefik_tls_config
                ok "Self-signed TLS certificate exists"
                return 0
            fi
        elif openssl x509 -in "$tls_dir/server.crt" -checkhost "$hostname" -noout >/dev/null 2>&1; then
            write_traefik_tls_config
            ok "Self-signed TLS certificate exists"
            return 0
        fi

        warn "Existing self-signed certificate does not match $hostname, regenerating"
        rm -f "$tls_dir/server.crt" "$tls_dir/server.key" "$tls_dir/ca.crt" "$tls_dir/ca.key" "$tls_dir/ca.srl"
    fi

    info "Generating self-signed TLS certificate for: $hostname"

    local san="DNS:localhost"
    if echo "$hostname" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        san="${san},IP:${hostname},IP:127.0.0.1"
    else
        san="${san},DNS:${hostname}"
    fi

    openssl genrsa -out "$tls_dir/ca.key" 2048 2>/dev/null
    openssl req -x509 -new -nodes \
        -key "$tls_dir/ca.key" \
        -sha256 -days 3650 \
        -subj "/CN=Fleet Manager Local CA" \
        -out "$tls_dir/ca.crt" 2>/dev/null

    openssl genrsa -out "$tls_dir/server.key" 2048 2>/dev/null
    openssl req -new \
        -key "$tls_dir/server.key" \
        -subj "/CN=${hostname}" \
        -out "$tls_dir/server.csr" 2>/dev/null

    openssl x509 -req \
        -in "$tls_dir/server.csr" \
        -CA "$tls_dir/ca.crt" \
        -CAkey "$tls_dir/ca.key" \
        -CAcreateserial \
        -out "$tls_dir/server.crt" \
        -days 3650 -sha256 \
        -extfile <(echo "subjectAltName=${san}") 2>/dev/null

    rm -f "$tls_dir/server.csr"
    chmod 0600 "$tls_dir/ca.key" "$tls_dir/server.key"
    chmod 0644 "$tls_dir/ca.crt" "$tls_dir/server.crt"

    ok "Certificate generated (valid 10 years, SAN: ${san})"

    write_traefik_tls_config
}
