# shellcheck shell=bash
# Shared Zitadel bring-up helpers. Sourced by private deploy.sh and public
# deploy-public.sh. The full bring-up sequences still diverge per deployment
# (private carries destructive reset-on-failure paths, an extra Action V2
# recheck, and optional extras that public lacks); only the pieces that are
# byte-identical across both are promoted here.

# Zitadel matches instances by exact Host header, so a default port must be
# stripped or instance lookup fails on a NAT hairpin. Given "host:port" and the
# externalsecure flag, echo the header with the default port (443 for HTTPS,
# 80 for HTTP) removed.
zitadel_host_header() {
    local host_port="$1"
    local external_secure="${2:-false}"
    if [ "$external_secure" = "true" ]; then
        printf '%s' "${host_port%:443}"
    else
        printf '%s' "${host_port%:80}"
    fi
}
