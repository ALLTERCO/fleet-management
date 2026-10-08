#!/usr/bin/env bash
# Host-wide deploy lock.
#
# Shared infrastructure and every tenant live on one host and share fleet-db,
# redis, traefik and the tenant networks. Two deploy operations running at once
# corrupt each other. One kernel flock over a well-known state file serialises
# them; the per-tenant lock stays as the inner lock.
#
# Requires _upd_boot_id from update.sh, which defines host reboot identity.

HOST_LOCK_FD=9
HOST_LOCK_DEPTH=0
# 1 only when this process itself took the lock, as opposed to inheriting it.
HOST_LOCK_OWNED=0

host_lock_file() {
  printf '%s' "${DEPLOY_HOST_LOCK_FILE:-${STATE_DIR:-deploy/state}/deploy-host.lock}"
}

host_lock_timeout() {
  printf '%s' "${DEPLOY_HOST_LOCK_TIMEOUT:-600}"
}

# host_lock_acquire <operation label>
host_lock_acquire() {
  local operation="$1"
  local lock_file timeout
  lock_file="$(host_lock_file)"
  timeout="$(host_lock_timeout)"

  # Nested operations and child processes reuse the same lock.
  if [ "$HOST_LOCK_DEPTH" -gt 0 ] || [ "${FM_DEPLOY_HOST_LOCK_HELD:-0}" = "1" ]; then
    HOST_LOCK_DEPTH=$((HOST_LOCK_DEPTH + 1))
    return 0
  fi

  mkdir -p "$(dirname "$lock_file")" || return 1

  if command -v flock >/dev/null 2>&1; then
    _host_lock_acquire_flock "$operation" "$lock_file" "$timeout" || return 1
  else
    _host_lock_acquire_fallback "$operation" "$lock_file" "$timeout" || return 1
  fi

  HOST_LOCK_DEPTH=1
  HOST_LOCK_OWNED=1
  export FM_DEPLOY_HOST_LOCK_HELD=1
  _host_lock_write_meta "$lock_file" "$operation"
}

host_lock_release() {
  [ "$HOST_LOCK_DEPTH" -gt 0 ] || return 0
  HOST_LOCK_DEPTH=$((HOST_LOCK_DEPTH - 1))
  [ "$HOST_LOCK_DEPTH" -eq 0 ] || return 0
  # An ancestor owns the lock; this process only borrowed it.
  [ "$HOST_LOCK_OWNED" = "1" ] || return 0

  local lock_file
  lock_file="$(host_lock_file)"
  if command -v flock >/dev/null 2>&1; then
    eval "exec ${HOST_LOCK_FD}>&-" 2>/dev/null || true
  else
    rm -rf "${lock_file}.d" 2>/dev/null || true
  fi
  HOST_LOCK_OWNED=0
  unset FM_DEPLOY_HOST_LOCK_HELD
}

# Runs <fn> under the host lock, releasing it even when <fn> fails.
host_lock_run() {
  local operation="$1"
  shift
  host_lock_acquire "$operation" || return 1
  local rc=0
  "$@" || rc=$?
  host_lock_release
  return "$rc"
}

_host_lock_acquire_flock() {
  local operation="$1" lock_file="$2" timeout="$3"
  eval "exec ${HOST_LOCK_FD}>>\"\$lock_file\"" || {
    log_error "Cannot open the host deploy lock: $lock_file"
    return 1
  }
  # Root may take the lock, but must hand the inode back to the repo owner.
  if [ "$(id -u)" -eq 0 ]; then
    chown --reference="$(dirname "$lock_file")" "$lock_file" || {
      eval "exec ${HOST_LOCK_FD}>&-" 2>/dev/null || true
      log_error "Cannot restore deployment ownership on the host lock: $lock_file"
      return 1
    }
    chmod 0644 "$lock_file" || {
      eval "exec ${HOST_LOCK_FD}>&-" 2>/dev/null || true
      log_error "Cannot restore permissions on the host lock: $lock_file"
      return 1
    }
  fi
  if flock -n "$HOST_LOCK_FD"; then
    return 0
  fi
  log_warn "Waiting up to ${timeout}s for the host deploy lock - $(_host_lock_holder "$lock_file")"
  if flock -w "$timeout" "$HOST_LOCK_FD"; then
    return 0
  fi
  eval "exec ${HOST_LOCK_FD}>&-" 2>/dev/null || true
  log_error "Host deploy lock still held after ${timeout}s - $(_host_lock_holder "$lock_file")"
  log_error "Refusing to run '$operation' concurrently with another deploy operation."
  return 1
}

# flock(1) is absent on some hosts. A lock directory is the portable equivalent.
_host_lock_acquire_fallback() {
  local operation="$1" lock_file="$2" timeout="$3"
  local lock_dir="${lock_file}.d"
  local waited=0 announced=false

  while true; do
    if mkdir "$lock_dir" 2>/dev/null; then
      return 0
    fi
    if _host_lock_fallback_is_stale "$lock_file"; then
      rm -rf "$lock_dir" 2>/dev/null || true
      continue
    fi
    if [ "$waited" -ge "$timeout" ]; then
      log_error "Host deploy lock still held after ${timeout}s - $(_host_lock_holder "$lock_file")"
      log_error "Refusing to run '$operation' concurrently with another deploy operation."
      return 1
    fi
    if [ "$announced" = false ]; then
      log_warn "Waiting up to ${timeout}s for the host deploy lock - $(_host_lock_holder "$lock_file")"
      announced=true
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

# Stale means the host rebooted or the owner process died.
_host_lock_fallback_is_stale() {
  local lock_file="$1"
  local pid boot
  IFS=$'\t' read -r pid boot _ <"$lock_file" 2>/dev/null || true
  [ "${boot:-}" = "$(_upd_boot_id)" ] \
    && [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null \
    && return 1
  return 0
}

_host_lock_write_meta() {
  local lock_file="$1" operation="$2"
  printf '%s\t%s\t%s\t%s\n' "$$" "$(_upd_boot_id)" "$(date +%s)" "$operation" >"$lock_file"
}

_host_lock_holder() {
  local lock_file="$1"
  local pid boot ts operation
  IFS=$'\t' read -r pid boot ts operation <"$lock_file" 2>/dev/null || true
  if [ -z "${pid:-}" ]; then
    printf 'holder unknown'
    return 0
  fi
  printf "held by '%s' (pid %s since %s)" "${operation:-unknown}" "$pid" "${ts:-unknown}"
}
