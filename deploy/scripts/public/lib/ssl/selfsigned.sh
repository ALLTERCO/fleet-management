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

    local san
    san="$(fm_selfsigned_san "$hostname")"

    fm_generate_ca "$tls_dir" "Fleet Manager Local CA" 3650
    fm_issue_server_cert "$tls_dir" "$hostname" 3650

    chmod 0600 "$tls_dir/ca.key" "$tls_dir/server.key"
    chmod 0644 "$tls_dir/ca.crt" "$tls_dir/server.crt"

    ok "Certificate generated (valid 10 years, SAN: ${san})"

    write_traefik_tls_config
}
