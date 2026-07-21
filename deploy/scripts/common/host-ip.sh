# shellcheck shell=bash
# host-ip.sh — single source of host IPv4 discovery for both deploy paths.
#
# We never hardcode an IP. We discover the host's IPs fresh on every run and
# prefer the default-route ("main") IP. The exclusion list drops loopback,
# link-local, docker/bridge, and VPN/tunnel interfaces so a VPN or Docker
# address is never mistaken for the address devices should reach us on.
#
# Both deployment loaders source this file and expose these functions under
# their own public names — the detection logic lives here once.

# All usable IPv4s on this host, one per line. Drops loopback, link-local,
# docker/bridge, and VPN/tunnel interfaces. Works on Linux (ip) and macOS
# (ifconfig).
detect_all_host_ips() {
  if command -v ip >/dev/null 2>&1; then
    ip -o -4 addr show scope global 2>/dev/null \
      | awk '$2 !~ /^(docker|br-|veth|tun|tap|lo)/ {sub(/\/.*/,"",$4); print $4}'
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig 2>/dev/null | awk '
      /^[a-z0-9]+:/ { iface=$1; sub(/:$/,"",iface) }
      /[[:space:]]inet / {
        if (iface ~ /^(lo|bridge|utun|tun|tap|vnic|llw|awdl|gif|stf)/) next
        if ($2 ~ /^(127\.|169\.254\.)/) next
        print $2
      }'
  fi
}

# The "main" IP: the source address the OS uses to reach the internet — the
# highest-priority default route. We ask the OS; we never guess an interface.
detect_default_route_ip() {
  local ip="" iface
  if command -v ip >/dev/null 2>&1; then
    ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[0-9.]+' | head -1)
  fi
  if [ -z "$ip" ] && command -v route >/dev/null 2>&1; then
    iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
    [ -n "$iface" ] && command -v ipconfig >/dev/null 2>&1 \
      && ip=$(ipconfig getifaddr "$iface" 2>/dev/null)
  fi
  [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
  return 1
}

# Single-IP detect: the main (default-route) IP, else the first discovered.
# Returns non-zero (and prints nothing) when no usable IP is found.
detect_host_ip() {
  local ip
  ip=$(detect_default_route_ip) || ip=$(detect_all_host_ips | head -1)
  [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
  return 1
}
