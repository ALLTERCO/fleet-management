#!/bin/sh
set -eu

allowed_csv="${NODE_RED_ALLOWED_NODES:-}"
extra_csv="${NODE_RED_EXTRA_NODES:-}"
builtin_node_path="${NODE_RED_BUILTIN_NODE_PATH:-/opt/fm-node-red-package}"

contains_node() {
  wanted="$1"
  old_ifs="$IFS"
  IFS=","
  for item in $allowed_csv; do
    item="$(printf '%s' "$item" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [ "$item" = "$wanted" ]; then
      IFS="$old_ifs"
      return 0
    fi
  done
  IFS="$old_ifs"
  return 1
}

install_args=""

if [ -f "$builtin_node_path/package.json" ]; then
  install_args="$install_args $builtin_node_path"
fi

if [ -n "$extra_csv" ]; then
  old_ifs="$IFS"
  IFS=","
  for node in $extra_csv; do
    node="$(printf '%s' "$node" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -n "$node" ] || continue
    if ! contains_node "$node"; then
      echo "Node-RED node '$node' is not in NODE_RED_ALLOWED_NODES" >&2
      exit 1
    fi
    install_args="$install_args $node"
  done
  IFS="$old_ifs"
fi

# Inputs of the last successful install; a restart with the same inputs
# skips npm, so Node-RED comes back without network.
install_fingerprint() {
  {
    printf '%s\n' "$install_args"
    if [ -f "$builtin_node_path/package.json" ]; then
      cat "$builtin_node_path/package.json"
    fi
  } | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(require("crypto").createHash("sha256").update(d).digest("hex")))'
}

install_is_current() {
  [ -f "$stamp_file" ] || return 1
  [ "$(cat "$stamp_file")" = "$1" ] || return 1
  # Missing modules (e.g. after a restore without node_modules) fail npm ls.
  npm ls --omit=dev --depth=0 >/dev/null 2>&1
}

stamp_file="/data/.fm-install-fingerprint"

if [ -n "$install_args" ]; then
  cd /data
  fingerprint="$(install_fingerprint)"
  if install_is_current "$fingerprint"; then
    echo "Node-RED nodes already installed; skipping npm install"
  else
    # shellcheck disable=SC2086 # install_args is a space-separated list.
    npm install --omit=dev --no-audit --no-fund $install_args
    printf '%s' "$fingerprint" > "$stamp_file"
  fi
fi

exec node-red --userDir /data --settings /data/settings.js
