#!/usr/bin/env bash
# State directories that compose bind-mounts. The deploy creates them before
# compose runs: Docker creates a missing bind source as root, and later deploy
# runs then cannot write it. deploy/tests/state-bind-dirs-unit.sh keeps these
# lists in step with the rendered compose files.

# shellcheck disable=SC2034 # read by the private and public deploy paths
STATE_BIND_DIRS=(
  backups/zitadel
  contract
  grafana/provisioning
  letsencrypt
  machinekey
  secrets
  system-api
  tls
  tls/dynamic
  traefik-dynamic
  traefik/dynamic
)

# Relative to deploy/state/clients/<id>, mounted by compose/templates/*.yml.
# shellcheck disable=SC2034 # read by render_client_compose
CLIENT_STATE_BIND_DIRS=(
  branding
  grafana/provisioning
  secrets
)

# ensure_state_bind_dirs <root> <relative dir>...
# Creates the dirs as the deploying user. Refuses, changing nothing, when one
# of them or a parent inside <root> exists but is not writable.
ensure_state_bind_dirs() {
  local root="$1"
  shift
  local blocked rel
  blocked="$(state_dirs_not_writable "$root" "$@")"
  if [ -n "$blocked" ]; then
    printf '[ERROR] Deploy state folders are not writable (Docker created them as root). Fix: sudo chown %s:%s %s\n' \
      "$(id -u)" "$(id -g)" "$(printf '%s\n' "$blocked" | tr '\n' ' ' | sed 's/ $//')" >&2
    return 1
  fi
  for rel in "$@"; do
    mkdir -p "$root/$rel" || return 1
  done
}

# Prints each existing dir, from <root> down to every listed dir, that this user cannot write.
state_dirs_not_writable() {
  local root="$1"
  shift
  local rel path part
  for rel in "$@"; do
    path="$root"
    while IFS= read -r part; do
      path="$path/$part"
      [ -e "$path" ] && [ ! -w "$path" ] && printf '%s\n' "$path"
    done < <(printf '%s\n' "$rel" | tr '/' '\n')
  done | awk '!seen[$0]++'
}
