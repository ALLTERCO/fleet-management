# shellcheck shell=bash
# Node-RED's own env file: only the keys its settings, start script and nodes
# read. Any flow editor can read container env vars, so Fleet Manager's other
# secrets must never reach this file. Derived from fm-runtime.env, the one source.

NODERED_RUNTIME_ENV_KEYS=(
    FM_NODE_RED_SERVICE_TOKEN
    FM_NODE_RED_PROXY_SECRET
    FM_NODE_RED_CREDENTIAL_SECRET
    FM_NODE_RED_ORG_ID
)

nodered_runtime_env_path() {
    printf '%s/nodered-runtime.env' "$1"
}

# stdout: the allowed KEY=value lines of a runtime env file; nothing when absent.
nodered_runtime_env_lines() {
    local runtime_env="$1" pattern rc=0
    [ -f "$runtime_env" ] || return 0
    pattern="^($(IFS='|'; printf '%s' "${NODERED_RUNTIME_ENV_KEYS[*]}"))="
    grep -E "$pattern" "$runtime_env" || rc=$?
    # grep: 1 = no match (fine), 2 = read error.
    [ "$rc" -le 1 ]
}

# stdout: the file content for the given allowed lines.
nodered_runtime_env_render() {
    printf '# Generated from fm-runtime.env: Node-RED keys only. Do not edit.\n%s\n' "$1"
}

# Writes <state_dir>/nodered-runtime.env (mode 600) from <state_dir>/fm-runtime.env.
nodered_runtime_env_write() {
    local state_dir="$1" target lines tmp
    target="$(nodered_runtime_env_path "$state_dir")"
    lines="$(nodered_runtime_env_lines "$state_dir/fm-runtime.env")" || return 1
    tmp="$(umask 077 && mktemp "${target}.XXXXXX")" || return 1
    nodered_runtime_env_render "$lines" >"$tmp" || { rm -f "$tmp"; return 1; }
    nodered_runtime_env_install "$tmp" "$target"
}

# Swap in the staged file; a failed write never leaves a half-written target.
nodered_runtime_env_install() {
    local tmp="$1" target="$2"
    if chmod 0600 "$tmp" && mv "$tmp" "$target"; then
        return 0
    fi
    rm -f "$tmp"
    return 1
}
