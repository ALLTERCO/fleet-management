# Edge network preflight, shared by the private and public deployment paths.
#
# FM_EDGE_SUBNET is the one value behind the fleet-edge network: Compose gives
# the network that subnet, and the app trusts forwarded headers from it
# (FM_DEVICE_INGRESS_TRUSTED_PROXY_CIDRS is derived from it in the compose
# files). Only Traefik and Fleet Manager join that network, so a peer on it is
# the proxy and nothing else. A subnet that overlaps another Docker network or
# a host route would make the address trust ambiguous, so the deploy refuses.
#
# edge_network_preflight <subnet> <existing-network-name>
#   Returns 0 when the subnet is usable; prints one line and returns 1 when it
#   is not. The named network may already exist with the same subnet (rerun);
#   its own host route (exact subnet on its own bridge) is then accepted.
# shellcheck shell=bash

edge_fleet_upstream() {
    # Traefik's upstream for Fleet Manager. The name exists only on fleet-edge,
    # so the proxy always connects from the trusted subnet.
    printf '%s\n' "http://fleet-manager-edge:7011"
}

edge_cidr_parse() {
    # Prints "<network-int> <prefix>" for a dotted IPv4 CIDR, or fails.
    local cidr="$1" ip prefix a b c d
    [[ "$cidr" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/([0-9]{1,2})$ ]] || return 1
    a="${BASH_REMATCH[1]}"; b="${BASH_REMATCH[2]}"; c="${BASH_REMATCH[3]}"; d="${BASH_REMATCH[4]}"
    prefix="${BASH_REMATCH[5]}"
    for ip in "$a" "$b" "$c" "$d"; do [ "$ip" -le 255 ] || return 1; done
    [ "$prefix" -le 32 ] || return 1
    local value=$(( (a << 24) | (b << 16) | (c << 8) | d ))
    local mask=$(( prefix == 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF ))
    printf '%s %s\n' "$(( value & mask ))" "$prefix"
}

edge_cidrs_overlap() {
    # Two IPv4 CIDRs overlap when the shorter prefix contains the other's base.
    local a_net a_prefix b_net b_prefix
    read -r a_net a_prefix < <(edge_cidr_parse "$1") || return 1
    read -r b_net b_prefix < <(edge_cidr_parse "$2") || return 1
    local prefix=$(( a_prefix < b_prefix ? a_prefix : b_prefix ))
    local mask=$(( prefix == 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF ))
    [ $(( a_net & mask )) -eq $(( b_net & mask )) ]
}

edge_subnet_well_formed() {
    # A /24 to /29: at least six usable addresses, never wider than a /24.
    local parsed prefix
    parsed="$(edge_cidr_parse "$1")" || return 1
    prefix="${parsed##* }"
    [ "$prefix" -ge 24 ] && [ "$prefix" -le 29 ]
}

edge_docker_network_subnets() {
    # Prints "<name> <subnet>" per Docker network that has an IPv4 subnet.
    local id
    for id in $(docker network ls -q 2>/dev/null); do
        docker network inspect "$id" \
            --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null
    done | awk 'NF >= 2 {for (i = 2; i <= NF; i++) if ($i ~ /^[0-9.]+\/[0-9]+$/) print $1, $i}'
}

edge_docker_network_bridge() {
    # Prints the host interface of a Docker bridge network: the configured
    # bridge name, else Docker's default br-<first 12 chars of the id>.
    local name="$1" id bridge
    read -r id bridge < <(docker network inspect "$name" \
        --format '{{.Id}} {{with index .Options "com.docker.network.bridge.name"}}{{.}}{{end}}' 2>/dev/null) || true
    [ -n "$id" ] || return 1
    if [ -n "$bridge" ]; then printf '%s\n' "$bridge"; else printf 'br-%s\n' "${id:0:12}"; fi
}

edge_host_routes() {
    # Prints the host's own IPv4 networks, "<cidr> <interface>" per line.
    if command -v ip >/dev/null 2>&1; then
        ip -4 route show 2>/dev/null | awk '$1 ~ /^[0-9.]+\/[0-9]+$/ {
            dev = ""; for (i = 2; i < NF; i++) if ($i == "dev") dev = $(i + 1); print $1, dev }'
    elif command -v netstat >/dev/null 2>&1; then
        netstat -rn -f inet 2>/dev/null | awk '$1 ~ /^[0-9.]+\/[0-9]+$/ {print $1, $4}'
    fi
}

edge_network_preflight() {
    local subnet="$1" own_network="$2" name existing route dev own_bridge=""
    if [ -z "$subnet" ]; then
        echo "FM_EDGE_SUBNET is not set; the fleet-edge network needs one subnet (for example 172.30.255.0/29)" >&2
        return 1
    fi
    if ! edge_subnet_well_formed "$subnet"; then
        echo "FM_EDGE_SUBNET=$subnet is not an IPv4 CIDR between /24 and /29" >&2
        return 1
    fi
    while read -r name existing; do
        [ -n "$name" ] || continue
        if [ "$name" = "$own_network" ]; then
            if [ "$existing" != "$subnet" ]; then
                echo "FM_EDGE_SUBNET=$subnet differs from the existing network $name ($existing); remove that network or keep the value" >&2
                return 1
            fi
            own_bridge="$(edge_docker_network_bridge "$own_network")" || own_bridge=""
            continue
        fi
        if edge_cidrs_overlap "$subnet" "$existing"; then
            echo "FM_EDGE_SUBNET=$subnet overlaps Docker network $name ($existing); choose another subnet" >&2
            return 1
        fi
    done < <(edge_docker_network_subnets)
    while read -r route dev; do
        [ -n "$route" ] || continue
        # A rerun: the existing edge network's own route, same subnet, same bridge.
        if [ -n "$own_bridge" ] && [ "$route" = "$subnet" ] && [ "$dev" = "$own_bridge" ]; then
            continue
        fi
        if edge_cidrs_overlap "$subnet" "$route"; then
            echo "FM_EDGE_SUBNET=$subnet overlaps a host route ($route${dev:+ on $dev}); choose another subnet" >&2
            return 1
        fi
    done < <(edge_host_routes)
    return 0
}
