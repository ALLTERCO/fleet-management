# lib/ssl.sh — TLS certificate generation, validation, and ACME setup

is_ip_address() {
    local value="${1:-}"
    [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || [[ "$value" == *:* ]]
}

is_valid_fqdn() {
    local domain="${1%.}"
    [ -n "$domain" ] || return 1
    [ "${#domain}" -le 253 ] || return 1
    [[ "$domain" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]]
}

resolve_domain_ips() {
    local domain="$1"

    if command -v getent &>/dev/null; then
        getent ahosts "$domain" 2>/dev/null | awk '{print $1}' | sort -u
        return 0
    fi

    if command -v dscacheutil &>/dev/null; then
        dscacheutil -q host -a name "$domain" 2>/dev/null | awk '/ip_address:/{print $2}' | sort -u
        return 0
    fi

    if command -v host &>/dev/null; then
        host "$domain" 2>/dev/null | awk '/has address/{print $4} /has IPv6 address/{print $5}' | sort -u
        return 0
    fi

    if command -v nslookup &>/dev/null; then
        nslookup "$domain" 2>/dev/null | awk '/^Address: /{print $2}' | sort -u
        return 0
    fi

    return 1
}

write_traefik_tls_config() {
    local dyn_dir="$STATE_DIR/tls/dynamic"
    mkdir -p "$dyn_dir"

    cat > "$dyn_dir/tls.yml" <<'EOF'
tls:
  certificates:
    - certFile: /etc/traefik/certs/server.crt
      keyFile: /etc/traefik/certs/server.key
  stores:
    default:
      defaultCertificate:
        certFile: /etc/traefik/certs/server.crt
        keyFile: /etc/traefik/certs/server.key
EOF

    chmod 0644 "$dyn_dir/tls.yml"
    ok "Traefik TLS config written"
}

install_custom_cert() {
    local tls_dir="$STATE_DIR/tls"

    mkdir -p "$tls_dir"
    cp "$SSL_CERT_FILE" "$tls_dir/server.crt"
    cp "$SSL_KEY_FILE" "$tls_dir/server.key"
    chmod 0644 "$tls_dir/server.crt" "$tls_dir/server.key"

    write_traefik_tls_config
    ok "Custom TLS certificate installed"
}

validate_custom_cert() {
    [ -n "$SSL_CERT_FILE" ] || {
        error "Custom SSL requires --cert /path/to/fullchain.pem"
        return 1
    }
    [ -n "$SSL_KEY_FILE" ] || {
        error "Custom SSL requires --key /path/to/privkey.pem"
        return 1
    }
    [ -f "$SSL_CERT_FILE" ] || {
        error "Custom certificate file not found: $SSL_CERT_FILE"
        return 1
    }
    [ -f "$SSL_KEY_FILE" ] || {
        error "Custom key file not found: $SSL_KEY_FILE"
        return 1
    }

    openssl x509 -in "$SSL_CERT_FILE" -noout >/dev/null 2>&1 || {
        error "Invalid X.509 certificate: $SSL_CERT_FILE"
        return 1
    }
    openssl pkey -in "$SSL_KEY_FILE" -noout >/dev/null 2>&1 || {
        error "Invalid private key: $SSL_KEY_FILE"
        return 1
    }

    local cert_pub key_pub
    cert_pub=$(openssl x509 -in "$SSL_CERT_FILE" -pubkey -noout 2>/dev/null | openssl pkey -pubin -outform pem 2>/dev/null | openssl sha256 2>/dev/null)
    key_pub=$(openssl pkey -in "$SSL_KEY_FILE" -pubout -outform pem 2>/dev/null | openssl sha256 2>/dev/null)
    if [ -z "$cert_pub" ] || [ -z "$key_pub" ] || [ "$cert_pub" != "$key_pub" ]; then
        error "Custom certificate and key do not match"
        return 1
    fi

    if ! openssl x509 -in "$SSL_CERT_FILE" -checkhost "${SSL_DOMAIN%.}" -noout >/dev/null 2>&1; then
        error "Custom certificate does not cover domain: ${SSL_DOMAIN%.}"
        return 1
    fi

    return 0
}

validate_ssl_config() {
    if [ "$WITH_SSL" != "true" ]; then
        return 0
    fi

    # Public SSL always terminates on port 443. Reject host:port syntax early.
    # Note: this also blocks bare IPv6 literals (which contain colons).
    # IPv6 literal support is not currently needed; add mode-aware parsing if it is.
    if [ -n "$SSL_DOMAIN" ] && [[ "$SSL_DOMAIN" == *:* ]]; then
        error "--domain must be a plain hostname, FQDN, or IPv4 address where supported; host:port and IPv6 literals are not supported"
        return 1
    fi

    if [ -z "$SSL_MODE" ]; then
        SSL_MODE="letsencrypt"
    fi

    case "$SSL_MODE" in
        letsencrypt)
            [ -n "$SSL_DOMAIN" ] || {
                error "Let's Encrypt SSL requires --domain example.com"
                return 1
            }
            if [ -z "$SSL_EMAIL" ]; then
                warn "No --email set. Certificate expiry notifications will NOT be delivered."
                warn "Set SSL_EMAIL in your environment or pass --email you@example.com"
            fi
            if is_ip_address "$SSL_DOMAIN"; then
                error "Let's Encrypt SSL requires a real domain name, not an IP address"
                return 1
            fi
            if [ "${SSL_DOMAIN%.}" = "localhost" ] || ! is_valid_fqdn "$SSL_DOMAIN"; then
                error "Invalid Let's Encrypt domain: $SSL_DOMAIN"
                return 1
            fi
            local resolved_ips
            resolved_ips="$(resolve_domain_ips "${SSL_DOMAIN%.}" || true)"
            if [ -z "$resolved_ips" ]; then
                error "Domain does not resolve yet: ${SSL_DOMAIN%.}"
                return 1
            fi
            ;;
        custom)
            [ -n "$SSL_DOMAIN" ] || {
                error "Custom SSL requires --domain example.com"
                return 1
            }
            if [ "${SSL_DOMAIN%.}" = "localhost" ] || ! is_valid_fqdn "$SSL_DOMAIN"; then
                error "Invalid custom SSL domain: $SSL_DOMAIN"
                return 1
            fi
            if [ -z "$SSL_CERT_FILE" ] && [ -f "$STATE_DIR/tls/server.crt" ]; then
                SSL_CERT_FILE="$STATE_DIR/tls/server.crt"
            fi
            if [ -z "$SSL_KEY_FILE" ] && [ -f "$STATE_DIR/tls/server.key" ]; then
                SSL_KEY_FILE="$STATE_DIR/tls/server.key"
            fi
            validate_custom_cert || return 1
            ;;
        selfsigned)
            if [ -n "$SSL_DOMAIN" ] && ! is_valid_fqdn "$SSL_DOMAIN" && ! is_ip_address "$SSL_DOMAIN"; then
                error "Self-signed SSL hostname must be an IP address or valid hostname"
                return 1
            fi
            ;;
        *)
            error "Unknown SSL mode: $SSL_MODE"
            return 1
            ;;
    esac

    return 0
}

write_traefik_routes_selfsigned() {
    local dyn_dir="$STATE_DIR/tls/dynamic"
    mkdir -p "$dyn_dir"

    cat > "$dyn_dir/routes.yml" <<'EOF'
# Auto-generated by deploy-public.sh — static routes for file provider
http:
  routers:
    zitadel:
      rule: "PathPrefix(`/.well-known/`) || PathPrefix(`/oauth/`) || PathPrefix(`/oidc/`) || PathPrefix(`/ui/`) || PathPrefix(`/debug/`) || PathPrefix(`/v2beta/`) || PathPrefix(`/v2/`) || PathPrefix(`/management/`) || PathPrefix(`/admin/`) || PathPrefix(`/auth/`) || PathPrefix(`/assets/v1/`) || PathPrefix(`/zitadel.`)"
      entryPoints: [websecure]
      service: zitadel
      tls: {}
      priority: 100
      middlewares: [strip-feature-policy]
    fleet:
      rule: "PathPrefix(`/`)"
      entryPoints: [websecure]
      service: fleet
      tls: {}
      priority: 10
      middlewares: [strip-identity]
  services:
    fleet:
      loadBalancer:
        servers:
          - url: "http://fleet-manager:7011"
    zitadel:
      loadBalancer:
        servers:
          - url: "http://zitadel:8080"
  middlewares:
    strip-identity:
      headers:
        customResponseHeaders:
          Server: ""
          X-Powered-By: ""
    strip-feature-policy:
      headers:
        customResponseHeaders:
          Feature-Policy: ""
EOF

    chmod 0644 "$dyn_dir/routes.yml"
    ok "Traefik routing config written"
}

write_traefik_routes_letsencrypt() {
    local domain="$1"
    local dyn_dir="$STATE_DIR/traefik-dynamic"
    mkdir -p "$dyn_dir"

    cat > "$dyn_dir/routes.yml" <<EOF
# Auto-generated by deploy-public.sh — static routes for file provider
http:
  routers:
    zitadel:
      rule: "Host(\`${domain}\`) && (PathPrefix(\`/.well-known/\`) || PathPrefix(\`/oauth/\`) || PathPrefix(\`/oidc/\`) || PathPrefix(\`/ui/\`) || PathPrefix(\`/debug/\`) || PathPrefix(\`/v2beta/\`) || PathPrefix(\`/v2/\`) || PathPrefix(\`/management/\`) || PathPrefix(\`/admin/\`) || PathPrefix(\`/auth/\`) || PathPrefix(\`/assets/v1/\`) || PathPrefix(\`/zitadel.\`))"
      entryPoints: [websecure]
      service: zitadel
      tls:
        certResolver: letsencrypt
      priority: 100
      middlewares: [strip-feature-policy]
    fleet:
      rule: "Host(\`${domain}\`)"
      entryPoints: [websecure]
      service: fleet
      tls:
        certResolver: letsencrypt
      priority: 10
      middlewares: [strip-identity]
  services:
    fleet:
      loadBalancer:
        servers:
          - url: "http://fleet-manager:7011"
    zitadel:
      loadBalancer:
        servers:
          - url: "http://zitadel:8080"
  middlewares:
    strip-identity:
      headers:
        customResponseHeaders:
          Server: ""
          X-Powered-By: ""
    strip-feature-policy:
      headers:
        customResponseHeaders:
          Feature-Policy: ""
EOF

    chmod 0644 "$dyn_dir/routes.yml"
    ok "Traefik routing config written (Let's Encrypt)"
}

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

    # Build Subject Alternative Names (support both IP and DNS)
    local san="DNS:localhost"
    if echo "$hostname" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        san="${san},IP:${hostname},IP:127.0.0.1"
    else
        san="${san},DNS:${hostname}"
    fi

    # Generate CA key + cert
    openssl genrsa -out "$tls_dir/ca.key" 2048 2>/dev/null
    openssl req -x509 -new -nodes \
        -key "$tls_dir/ca.key" \
        -sha256 -days 3650 \
        -subj "/CN=Fleet Manager Local CA" \
        -out "$tls_dir/ca.crt" 2>/dev/null

    # Generate server key + CSR
    openssl genrsa -out "$tls_dir/server.key" 2048 2>/dev/null
    openssl req -new \
        -key "$tls_dir/server.key" \
        -subj "/CN=${hostname}" \
        -out "$tls_dir/server.csr" 2>/dev/null

    # Sign with CA, including SANs
    openssl x509 -req \
        -in "$tls_dir/server.csr" \
        -CA "$tls_dir/ca.crt" \
        -CAkey "$tls_dir/ca.key" \
        -CAcreateserial \
        -out "$tls_dir/server.crt" \
        -days 3650 -sha256 \
        -extfile <(echo "subjectAltName=${san}") 2>/dev/null

    rm -f "$tls_dir/server.csr"
    chmod 0600 "$tls_dir/ca.key"
    chmod 0644 "$tls_dir/server.key" "$tls_dir/ca.crt" "$tls_dir/server.crt"

    ok "Certificate generated (valid 10 years, SAN: ${san})"

    write_traefik_tls_config
}
