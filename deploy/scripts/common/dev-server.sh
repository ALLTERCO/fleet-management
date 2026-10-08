#!/usr/bin/env bash
# shellcheck shell=bash
# Run Fleet Manager from source: backend under tsx watch, UI from the Vite dev
# server, database and Redis in Docker. Shared by deploy.sh and deploy-public.sh.
#
# The caller must define dev_server_stop_infrastructure. Optional hooks:
#   dev_server_hook_prepare <frontend_dir>         before anything starts
#   dev_server_hook_after_frontend <frontend_dir>  once Vite answers
#   dev_server_hook_cleanup <frontend_dir>         on shutdown
#   dev_server_profile_simulator <profile>         prints a simulator function

_dev_server_error() {
  echo -e "\033[0;31m[ERROR]\033[0m $*" >&2
}

_dev_server_run_hook() {
  local hook="$1"
  shift
  if declare -F "$hook" >/dev/null; then
    "$hook" "$@"
  fi
}

# Install deps when node_modules is missing OR older than the manifests.
# A pull that bumps package.json/package-lock.json leaves node_modules
# stale; without this the next `tsc` fails on not-yet-installed modules.
dev_deps_stale() {
  local dir="$1"
  [ ! -d "$dir/node_modules" ] && return 0
  [ "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ] && return 0
  [ "$dir/package.json" -nt "$dir/node_modules/.package-lock.json" ] && return 0
  return 1
}

dev_install_if_stale() {
  local dir="$1"
  local label="$2"
  dev_deps_stale "$dir" || return 0
  echo -e "\033[1;33m[setup]\033[0m Installing ${label} dependencies (node_modules missing or stale)..."
  (cd "$dir" && npm install --silent)
}

dev_server_reconnect_limit() {
  local device_count="$1"
  echo $((device_count * 2 + 20))
}

dev_server_ca_dir() {
  local deploy_dir="${1%/}"
  printf '%s/state/tls\n' "$deploy_dir"
}

dev_server_force_vite_optimization() {
  [ "${FM_BUILD_MODE:-}" = "client" ]
}

dev_remove_legacy_config() {
  local repo_root="${1%/}"
  rm -f "$repo_root/.fleet-managerrc"
}

validate_dev_server_ports() {
  local fm_port="${FLEET_MANAGER_PORT:-7011}"
  local failed=false
  local port
  local ports=("$fm_port" 5173)
  # Client mode also brings up a second Vite on 5174.
  if [ "${FM_BUILD_MODE:-}" = "client" ]; then
    ports+=(5174)
  fi
  for port in "${ports[@]}"; do
    if ! check_port_available "$port"; then
      _dev_server_error "Port $port is already in use by another dev process."
      failed=true
    fi
  done
  if [ "$failed" = "true" ]; then
    _dev_server_error "Stop the existing dev server before running up again."
    return 1
  fi
}

dev_server_start() {
  local repo_root="$1"
  local deploy_dir="${2:-$repo_root/deploy}"
  local backend_dir="$repo_root/backend"
  local frontend_dir="$repo_root/frontend"
  local fm_port="${FLEET_MANAGER_PORT:-7011}"
  local fm_ca_dir
  fm_ca_dir="$(dev_server_ca_dir "$deploy_dir")"
  _dev_server_run_hook dev_server_hook_prepare "$frontend_dir" || return 1
  ensure_local_ca "$fm_ca_dir"
  dev_install_if_stale "$backend_dir" "backend"
  dev_install_if_stale "$frontend_dir" "frontend"

  local seed_count="${FM_SEED_DEMO_DEVICE_COUNT:-0}"
  local handshake_limit=60
  local connection_limit=50
  local reconnect_limit=100
  local org_connection_limit=500
  local org_handshake_limit=300
  # Sized to the simulated fleet on EVERY dev run, not only when seeding.
  #
  # The defaults above describe real devices on real networks. A simulated fleet
  # is one address, so 350 devices blow the 100-per-window reconnect cap on
  # startup, that address is then blocked, every device is refused, they all
  # retry and the block re-arms. Nothing registers, every chart is empty, and the
  # only trace is rows in device_ingress_rejection that nobody thinks to read.
  if [ "$seed_count" = "0" ]; then
    seed_count=$(cd "$backend_dir" && node --import tsx \
      src/devSimulation/main.ts --print-ids 2>/dev/null | wc -l | tr -d ' ')
  fi
  # A prepare hook can export a bigger fleet than the default profile set; a
  # cap sized to the smaller count still blocks the bigger fleet.
  if [ "${FM_SEED_DEMO_DEVICE_COUNT:-0}" -gt "${seed_count:-0}" ] 2>/dev/null; then
    seed_count="$FM_SEED_DEMO_DEVICE_COUNT"
  fi
  if [ "${seed_count:-0}" -gt 0 ]; then
    handshake_limit=$((seed_count * 20))
    connection_limit=$((seed_count + 20))
    # Devices connect once to the waiting room, then reconnect after approval.
    reconnect_limit=$(dev_server_reconnect_limit "$seed_count")
    org_connection_limit=$((seed_count + 20))
    org_handshake_limit=$((seed_count * 20))
  fi

  local green='\033[0;32m'
  local yellow='\033[1;33m'
  local magenta='\033[0;35m'
  local red='\033[0;31m'
  local dim='\033[2m'
  local bold='\033[1m'
  local reset='\033[0m'

  dev_cleanup() {
    # Block re-entry: another Ctrl-C while we're cleaning up would race kill 0.
    trap '' INT TERM
    echo ""
    echo -e "${bold}Shutting down dev server...${reset}"
    # Kill direct children (tsc, node, vite, sed). node --watch forwards
    # SIGTERM to its app child, so SIGTERM here propagates the whole tree.
    local child_pids
    child_pids=$(jobs -p 2>/dev/null)
    if [ -n "$child_pids" ]; then
      # shellcheck disable=SC2086  # word-splitting is required to pass PIDs as separate args
      kill -TERM $child_pids 2>/dev/null || true
      # Up to 5s grace for graceful exit before escalating.
      local waited=0
      while [ "$waited" -lt 5 ] && [ -n "$(jobs -p 2>/dev/null)" ]; do
        sleep 1
        waited=$((waited + 1))
      done
      local survivors
      survivors=$(jobs -p 2>/dev/null)
      if [ -n "$survivors" ]; then
        # shellcheck disable=SC2086  # word-splitting is required to pass PIDs as separate args
        kill -KILL $survivors 2>/dev/null || true
      fi
    fi
    wait 2>/dev/null || true
    echo -e "${dim}Stopping infrastructure...${reset}"
    dev_server_stop_infrastructure 2>/dev/null || true
    _dev_server_run_hook dev_server_hook_cleanup "$frontend_dir"
    dev_remove_legacy_config "$repo_root"
    echo -e "${green}Dev environment stopped.${reset}"
    exit 0
  }
  trap dev_cleanup INT TERM HUP

  # devMode skips Zitadel; mapStyleUrl mirrors what entrypoint.sh emits in
  # prod so the map doesn't fall back to the openfreemap.org default.
  local map_style="${FM_UI_MAP_STYLE_URL:-https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json}"
  cat > "$frontend_dir/public/runtime-config.js" <<JSEOF
window.__FM_RUNTIME_CONFIG__ = {
  devMode: true,
  mapStyleUrl: "$map_style"
};
JSEOF

  echo -e "${yellow}[build]${reset} Compiling backend TypeScript..."
  (cd "$backend_dir" && npx tsc) || {
    echo -e "${red}[build]${reset} Backend compilation failed. Fix errors and retry."
    dev_cleanup
  }

  # Vite dev server (HMR): in DEV_MODE the backend proxies to it on one port,
  # so a save updates the browser instantly. DEP0205 silenced; heap bumped for
  # the heavy vendor graph (echarts/three/maplibre/deckgl/pixi).
  # External templates need a fresh dependency optimizer cache.
  local -a vite_args=(--host=0.0.0.0)
  if dev_server_force_vite_optimization; then
    vite_args+=(--force)
  fi
  echo -e "${magenta}[frontend]${reset} Starting Vite dev server (HMR)..."
  (cd "$frontend_dir" && NODE_OPTIONS="--disable-warning=DEP0205 --max-old-space-size=8192" exec npx vite "${vite_args[@]}" 2>&1) | sed -u "s/^/[frontend] /" &

  # Wait for Vite so the backend's dev proxy doesn't 502 on boot.
  local frontend_wait=0
  while ! curl -sf "http://localhost:5173/" >/dev/null 2>&1 && [ "$frontend_wait" -lt 60 ]; do
    sleep 1
    frontend_wait=$((frontend_wait + 1))
  done

  _dev_server_run_hook dev_server_hook_after_frontend "$frontend_dir"

  # tsx watch forwards SIGTERM cleanly; `node --watch` IPC supervisor doesn't.
  # DEP0205: tsx still calls deprecated module.register() — silenced only here.
  # Dev boots full observability (level 3) for development stats; the rc turns
  # it on, FM_OBSERVABILITY_LEVEL sets the level. Override by exporting it.
  echo -e "${green}[backend]${reset} Starting backend (tsx watch)..."
  (cd "$backend_dir" \
    && FM_LOCAL_CA_DIR="$fm_ca_dir" \
      FM_OBSERVABILITY_LEVEL="${FM_OBSERVABILITY_LEVEL:-3}" \
      FM_DEVICE_INGRESS_HANDSHAKES_PER_IP_PER_MINUTE="${FM_DEVICE_INGRESS_HANDSHAKES_PER_IP_PER_MINUTE:-$handshake_limit}" \
      FM_DEVICE_INGRESS_MAX_CONNECTIONS_PER_IP="${FM_DEVICE_INGRESS_MAX_CONNECTIONS_PER_IP:-$connection_limit}" \
      FM_DEVICE_INGRESS_RECONNECT_IP_MAX_PER_WINDOW="${FM_DEVICE_INGRESS_RECONNECT_IP_MAX_PER_WINDOW:-$reconnect_limit}" \
      FM_DEVICE_INGRESS_MAX_CONNECTIONS_PER_ORG="${FM_DEVICE_INGRESS_MAX_CONNECTIONS_PER_ORG:-$org_connection_limit}" \
      FM_DEVICE_INGRESS_HANDSHAKES_PER_ORG_PER_MINUTE="${FM_DEVICE_INGRESS_HANDSHAKES_PER_ORG_PER_MINUTE:-$org_handshake_limit}" \
      NODE_OPTIONS="--disable-warning=DEP0205" \
      exec ./node_modules/.bin/tsx watch --clear-screen=false --trace-warnings src/app.ts 2>&1) \
    | sed -u "s/^/[backend] /" &

  local host_ip
  host_ip=$(detect_host_ip 2>/dev/null || echo "localhost")

  echo ""
  echo -e "${bold}══════════════════════════════════════════════════════════════${reset}"
  echo -e "${bold}  Dev server running — all services active${reset}"
  echo -e "${bold}══════════════════════════════════════════════════════════════${reset}"
  echo ""
  echo -e "  ${green}App${reset}       http://localhost:${fm_port}"
  echo -e "  ${yellow}Devices${reset}   ws://${host_ip}:${fm_port}/shelly"
  echo -e "  ${dim}Login:    admin / admin${reset}"
  echo ""
  echo -e "  ${dim}Backend:  auto-restarts on .ts changes${reset}"
  echo -e "  ${dim}Frontend: auto-rebuilds on .vue/.ts changes (refresh browser)${reset}"
  echo -e "  ${dim}Press Ctrl+C to stop everything${reset}"
  echo ""

  if [ "${SEED_AFTER_UP:-false}" = "true" ]; then
    dev_server_seed_when_ready "$fm_port" "$backend_dir" &
  fi

  wait
}

# Polls /health and dev auth before running demo seed.
dev_server_seed_when_ready() {
  local port="$1"
  local backend_dir="$2"
  local tries=0
  local max_tries=120
  while [ "$tries" -lt "$max_tries" ]; do
    if curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then
      if dev_server_seed_auth_ready "$port"; then
        dev_server_run_seeded_simulator "$port" "$backend_dir" "$REPO_ROOT" "$DEPLOY_DIR"
        return
      fi
    fi
    sleep 1
    tries=$((tries + 1))
  done
  echo "[seed]   Backend did not become reachable in ${max_tries}s — skipped." >&2
}

dev_server_run_seeded_simulator() {
  local port="$1"
  local backend_dir="$2"
  local repo_root="${3:-$REPO_ROOT}"
  local deploy_dir="${4:-$DEPLOY_DIR}"
  local profile_simulator=""
  if declare -F dev_server_profile_simulator >/dev/null; then
    profile_simulator="$(dev_server_profile_simulator "${FM_SEED_SIMULATOR_PROFILE:-}")"
  fi
  if [ -n "$profile_simulator" ]; then
    "$profile_simulator" "$port" "$repo_root" "$deploy_dir"
    return
  fi
  local count ids ids_json blu_ids blu_ids_json simulator_pid
  local -a count_args=()
  local -a profile_args=()
  local -a scenario_args=()
  local -a retention_args=()
  if [ -n "${FM_SEED_DEMO_DEVICE_COUNT:-}" ]; then
    count_args=(--count "$FM_SEED_DEMO_DEVICE_COUNT")
  fi
  # A scenario that seeds its own shaped meter history must not also let the
  # devices replay 60 days of flat on-device records: the two would describe
  # the same days with different numbers. Keep just enough for the live tail.
  if [ -n "${FM_SEED_SIMULATOR_EM_HISTORY_SECONDS:-}" ]; then
    retention_args=(--em-history-seconds "$FM_SEED_SIMULATOR_EM_HISTORY_SECONDS")
  fi
  if [ -n "${FM_SEED_SIMULATOR_DEVICE_PROFILES:-}" ]; then
    profile_args=(--profiles "$FM_SEED_SIMULATOR_DEVICE_PROFILES")
  fi
  if [ -n "${FM_SEED_SIMULATOR_SCENARIO:-}" ]; then
    scenario_args=(--scenario "$FM_SEED_SIMULATOR_SCENARIO")
  fi

  ids=$(cd "$backend_dir" && node --import tsx \
    src/devSimulation/main.ts "${count_args[@]}" "${profile_args[@]}" \
    "${scenario_args[@]}" --print-ids)
  ids_json=$(printf '%s\n' "$ids" | jq -Rsc \
    'split("\n") | map(select(length > 0))')
  blu_ids=$(cd "$backend_dir" && node --import tsx \
    src/devSimulation/main.ts "${count_args[@]}" "${profile_args[@]}" \
    "${scenario_args[@]}" --print-blu-ids)
  blu_ids_json=$(printf '%s\n' "$blu_ids" | jq -Rsc \
    'split("\n") | map(select(length > 0))')
  # Which gateway hears which child, so a seed can place each child where its
  # own gateway sits. The flat list above cannot say that.
  blu_owners=$(cd "$backend_dir" && node --import tsx \
    src/devSimulation/main.ts "${count_args[@]}" "${profile_args[@]}" \
    "${scenario_args[@]}" --print-blu-owners)
  blu_owners_json=$(printf '%s\n' "$blu_owners" | jq -Rsc '
    split("\n") | map(select(length > 0) | split("\t"))
    | reduce .[] as $pair ({}; .[$pair[0]] += [$pair[1]])')
  count=$(printf '%s' "$ids_json" | jq 'length')
  export FM_SEED_DEVICE_IDS_JSON="$ids_json"
  export FM_SEED_BLU_DEVICE_IDS_JSON="$blu_ids_json"
  export FM_SEED_BLU_OWNERS_JSON="$blu_owners_json"
  export FM_SEED_DEMO_DEVICE_COUNT="$count"

  echo "[simulator] Starting $count stateful Shelly devices..."
  (cd "$backend_dir" && exec node --import tsx \
    src/devSimulation/main.ts \
    --ws-url "ws://127.0.0.1:${port}/shelly" \
    "${count_args[@]}" "${profile_args[@]}" "${scenario_args[@]}" \
    "${retention_args[@]}") &
  simulator_pid=$!
  # Capture the local PID before the EXIT trap runs.
  # shellcheck disable=SC2064
  trap "kill -TERM '$simulator_pid' 2>/dev/null || true" EXIT
  trap 'exit 0' INT TERM HUP

  local FM_SEED_URL
  FM_SEED_URL="http://localhost:${port}"
  export FM_SEED_URL
  seed_load_base_url true
  seed_load_token_dev
  dev_server_wait_for_simulator "$ids_json" "available" || return 1

  echo "[seed]   Devices ready — running demo seed..."
  cmd_seed | sed -u "s/^/[seed]   /"
  dev_server_wait_for_simulator "$ids_json" "online" || return 1
  echo "[simulator] $count devices admitted and online."
  wait "$simulator_pid"
}

dev_server_wait_for_simulator() {
  local expected_json="$1"
  local state="$2"
  local expected_count attempt=0 max_attempts=120 matched
  expected_count=$(printf '%s' "$expected_json" | jq 'length')

  while [ "$attempt" -lt "$max_attempts" ]; do
    if [ "$state" = "available" ]; then
      matched=$(dev_server_available_simulator_count "$expected_json")
    else
      matched=$(dev_server_online_simulator_count "$expected_json")
    fi
    if [ "$matched" = "$expected_count" ]; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  echo "[simulator] Expected $expected_count devices, found $matched $state." >&2
  return 1
}

dev_server_available_simulator_count() {
  local expected_json="$1"
  local pending devices
  pending=$(_seed_rpc 'WaitingRoom.List' '{"limit":500,"state":"open"}')
  devices=$(_seed_rpc 'Device.List' '{"limit":500}')
  # Stream the RPC payloads through stdin instead of placing them in argv.
  # A 250-device Device.List response can exceed the host's argument-size limit.
  printf '%s\n%s\n%s\n' "$expected_json" "$pending" "$devices" | jq -s '
      .[0] as $expected
      | .[1] as $pending
      | .[2] as $devices
      | ([
          $pending.items[]?.shellyID,
          $devices.items[]?.shellyID
      ] | unique) as $known
      | [$expected[] as $id | select($known | index($id)) | $id]
      | length
    '
}

dev_server_online_simulator_count() {
  local expected_json="$1"
  local devices
  devices=$(_seed_rpc 'Device.List' '{"limit":500}')
  printf '%s\n%s\n' "$expected_json" "$devices" | jq -s '
      .[0] as $expected
      | .[1] as $devices
      | [$devices.items[]?
        | select(.presence == "online")
        | .shellyID
        | select(. as $id | $expected | index($id))]
      | unique
      | length
    '
}

dev_server_seed_auth_ready() {
  local port="$1"
  seed_load_base_url true
  FM_BASE_URL="http://localhost:${port}" seed_load_token_dev >/dev/null 2>&1
}
