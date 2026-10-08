#!/usr/bin/env bash

kdf_salt_from_env_file() (
  local state_file="$1"
  [ -f "$state_file" ] || return 1
  unset FM_SECRET_KDF_SALT
  # shellcheck source=/dev/null
  source "$state_file"
  printf '%s' "${FM_SECRET_KDF_SALT:-}"
)

kdf_salt_from_container() {
  local container="$1"
  [ -n "$container" ] || return 1
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null \
    | awk -F= '$1 == "FM_SECRET_KDF_SALT" {sub(/^[^=]*=/, ""); print; exit}'
}

kdf_salt_preflight() {
  local scope="$1"
  local state_file="$2"
  local container="$3"
  local deployed_marker="$4"
  local persisted desired running

  persisted="$(kdf_salt_from_env_file "$state_file")"
  desired="${FM_SECRET_KDF_SALT:-}"

  if [ -z "$container" ] || ! docker inspect "$container" >/dev/null 2>&1; then
    if [ -e "$deployed_marker" ]; then
      _kdf_salt_error "$scope has deployment history but no container from which to verify its KDF salt."
      _kdf_salt_error "Restore the prior container or recover the original salt from approved secret state before recreating it."
      return 1
    fi
    # The persisted file is the approved salt; nothing is ever generated here.
    if [ -n "$persisted" ] && [ -n "$desired" ] && [ "$persisted" = "$desired" ]; then
      return 0
    fi
    if [ -n "$persisted" ] && [ -z "$desired" ]; then
      _kdf_salt_error "$scope has a persisted KDF salt but no requested value. Refusing its first start."
      return 1
    fi
    if [ -z "$persisted" ] && [ -n "$desired" ]; then
      _kdf_salt_error "$scope has a requested KDF salt but no persisted value. Refusing its first start."
      return 1
    fi
    if [ -n "$persisted" ] && [ -n "$desired" ] && [ "$persisted" != "$desired" ]; then
      _kdf_salt_error "$scope persisted and requested KDF salts differ. Refusing its first start."
      return 1
    fi
    return 0
  fi

  if [ -z "$persisted" ]; then
    _kdf_salt_error "$scope has no persisted KDF salt. Refusing to restart or recreate it."
    return 1
  fi
  if [ -z "$desired" ]; then
    _kdf_salt_error "$scope has no requested KDF salt. Refusing to restart or recreate it."
    return 1
  fi
  running="$(kdf_salt_from_container "$container")"
  if [ -z "$running" ]; then
    _kdf_salt_error "$scope is running without an effective KDF salt. Refusing to restart or recreate it."
    return 1
  fi
  if [ "$running" != "$persisted" ] || [ "$desired" != "$persisted" ]; then
    _kdf_salt_error "$scope running, persisted and requested KDF salts do not match. Refusing to restart or recreate it."
    return 1
  fi
}

_kdf_salt_error() {
  if declare -F log_error >/dev/null 2>&1; then
    log_error "$*"
  elif declare -F error >/dev/null 2>&1; then
    error "$*"
  else
    printf 'ERROR: %s\n' "$*" >&2
  fi
}
