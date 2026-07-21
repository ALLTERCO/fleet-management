# shellcheck shell=bash
# Single source for self-signed CA + server certificate generation.
#
# Both TLS loaders call these primitives so the openssl CA + server-cert + SAN
# sequence lives in exactly one place.
#
# These are pure generators: they write the fixed key/cert basenames into the
# given tls_dir and nothing else. Each caller keeps its own gating (skip when
# the existing cert already matches), file permissions, CA common name, and
# log messages — those are where the two paths legitimately differ.

# Build the subjectAltName string a server cert needs. Always covers localhost;
# for an IPv4 host it adds the IP and loopback IP, otherwise the hostname as DNS.
# WHY here: both callers need the identical list, so the list is defined once.
fm_selfsigned_san() {
  local hostname="$1"
  local san="DNS:localhost"
  if printf '%s' "$hostname" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    san="${san},IP:${hostname},IP:127.0.0.1"
  else
    san="${san},DNS:${hostname}"
  fi
  printf '%s' "$san"
}

# Generate a self-signed CA (ca.key + ca.crt) in tls_dir.
# Args: tls_dir  ca_common_name  [validity_days=3650]  [rsa_bits=2048]
# Does not set file permissions — the caller owns that decision.
fm_generate_ca() {
  local tls_dir="$1"
  local ca_cn="$2"
  local days="${3:-3650}"
  local bits="${4:-2048}"

  mkdir -p "$tls_dir"
  openssl genrsa -out "$tls_dir/ca.key" "$bits" 2>/dev/null
  openssl req -x509 -new -nodes \
    -key "$tls_dir/ca.key" -sha256 -days "$days" \
    -subj "/CN=${ca_cn}" \
    -out "$tls_dir/ca.crt" 2>/dev/null
}

# Issue a server cert (server.key + server.crt) in tls_dir, signed by the CA
# already present there (ca.crt + ca.key). The cert's CN is the hostname and
# its SANs come from fm_selfsigned_san. The intermediate CSR is removed.
# Args: tls_dir  hostname  [validity_days=3650]  [rsa_bits=2048]
# Does not set file permissions — the caller owns that decision.
fm_issue_server_cert() {
  local tls_dir="$1"
  local hostname="$2"
  local days="${3:-3650}"
  local bits="${4:-2048}"
  local san csr="$tls_dir/server.csr"

  san="$(fm_selfsigned_san "$hostname")"

  openssl genrsa -out "$tls_dir/server.key" "$bits" 2>/dev/null
  openssl req -new -key "$tls_dir/server.key" \
    -subj "/CN=${hostname}" \
    -out "$csr" 2>/dev/null
  openssl x509 -req -in "$csr" \
    -CA "$tls_dir/ca.crt" -CAkey "$tls_dir/ca.key" -CAcreateserial \
    -out "$tls_dir/server.crt" -days "$days" -sha256 \
    -extfile <(printf 'subjectAltName=%s' "$san") 2>/dev/null
  rm -f "$csr"
}
