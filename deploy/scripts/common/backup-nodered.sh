# shellcheck shell=bash
# Node-RED data volume backup + restore (flows, credentials, context, config).
#
# flows_cred.json is encrypted with FM_NODE_RED_CREDENTIAL_SECRET, which lives
# in the deploy state env file, not in the volume. The manifest keeps a
# fingerprint of that secret so a restore can tell whether the credentials it
# brings back can still be decrypted.
set -o pipefail

NRBK_HELPER_IMAGE="${NRBK_HELPER_IMAGE:-busybox}"
NRBK_SECRET_VAR="FM_NODE_RED_CREDENTIAL_SECRET"
NRBK_STOP_TIMEOUT="${NRBK_STOP_TIMEOUT:-30}"

# Compose labels name the volume; the real name carries a project prefix.
# stdout: volume name. rc 1 when the stack has no Node-RED volume.
nrbk_resolve_volume() {
    local project="$1" volume_key="$2" name
    name="$(docker volume ls -q \
        --filter "label=com.docker.compose.project=${project}" \
        --filter "label=com.docker.compose.volume=${volume_key}" | head -1)"
    [ -n "$name" ] || return 1
    printf '%s' "$name"
}

# Running Node-RED container of a compose project. stdout: id or nothing.
nrbk_running_container() {
    local project="$1"
    docker ps -q \
        --filter "label=com.docker.compose.project=${project}" \
        --filter "label=com.docker.compose.service=nodered" | head -1
}

# sha256 of the credential secret in a state env file; empty when absent.
nrbk_secret_fingerprint() {
    local state_env="$1" secret
    [ -f "$state_env" ] || return 0
    secret="$(awk -F= -v key="$NRBK_SECRET_VAR" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$state_env")"
    [ -n "$secret" ] || return 0
    printf '%s' "$secret" | bk_checksum /dev/stdin
}

# Tar the volume minus installed modules: start.sh reinstalls them.
# Streamed through stdout so the host user owns the archive, not root.
nrbk_archive_volume() {
    local volume="$1" archive="$2"
    docker run --rm \
        -v "${volume}:/data:ro" \
        "$NRBK_HELPER_IMAGE" \
        tar -czf - -C /data --exclude ./node_modules --exclude ./.npm . \
        > "$archive"
}

# Listing captured first: with pipefail, grep -q closing the pipe early
# would make tar fail and turn a match into a miss.
nrbk_archive_lists() {
    local archive="$1" entry="$2" listing
    listing="$(tar -tzf "$archive" 2>/dev/null)" || return 1
    grep -qx -- "$entry" <<< "$listing"
}

nrbk_manifest_path() {
    printf '%s.manifest.json' "$1"
}

nrbk_write_manifest() {
    local archive="$1" volume="$2"
    local fingerprint flows creds
    fingerprint="$(nrbk_secret_fingerprint "${NRBK_STATE_ENV:-}")"
    flows=false
    creds=false
    nrbk_archive_lists "$archive" "./flows.json" && flows=true
    nrbk_archive_lists "$archive" "./flows_cred.json" && creds=true
    jq -n \
        --arg kind "fleet-manager-nodered-volume-backup" \
        --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg label "${NRBK_LABEL:-manual}" \
        --arg volume "$volume" \
        --arg path "$archive" \
        --arg sha256 "$(bk_checksum "$archive")" \
        --arg sizeBytes "$(bk_file_size "$archive")" \
        --arg secretSha256 "$fingerprint" \
        --arg stateEnv "${NRBK_STATE_ENV:-}" \
        --argjson flows "$flows" \
        --argjson creds "$creds" \
        '{
            schemaVersion: "1",
            kind: $kind,
            label: $label,
            createdAt: $createdAt,
            volume: $volume,
            artifact: {path: $path, sha256: $sha256, sizeBytes: ($sizeBytes | tonumber)},
            contents: {flows: $flows, credentials: $creds},
            credentialSecret: {stateEnv: $stateEnv, sha256: $secretSha256}
        }' > "$(nrbk_manifest_path "$archive")" || return 1
    chmod 0600 "$(nrbk_manifest_path "$archive")"
}

# Encrypted credentials are useless without the secret: say so loudly.
nrbk_warn_secret_backup() {
    local archive="$1" fingerprint
    nrbk_archive_lists "$archive" "./flows_cred.json" || return 0
    fingerprint="$(nrbk_secret_fingerprint "${NRBK_STATE_ENV:-}")"
    if [ -z "$fingerprint" ]; then
        echo "[nrbk] WARNING: flows_cred.json backed up but ${NRBK_SECRET_VAR} was not found in '${NRBK_STATE_ENV:-<unset>}'." >&2
        echo "[nrbk] WARNING: without that secret the saved credentials cannot be decrypted." >&2
        return 0
    fi
    echo "[nrbk] REMINDER: flows_cred.json needs ${NRBK_SECRET_VAR} from ${NRBK_STATE_ENV}. Back up deploy/state too." >&2
}

# nrbk_create <volume> <out_dir> — stdout: archive path.
# Env: NRBK_STATE_ENV (state env file holding the secret), NRBK_LABEL.
nrbk_create() {
    local volume="$1" out_dir="$2" archive
    { mkdir -p "$out_dir" && chmod 0700 "$out_dir"; } || return 1
    archive="$(cd "$out_dir" && pwd)/nodered-${NRBK_LABEL:-manual}-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
    if ! nrbk_archive_volume "$volume" "$archive" || ! tar -tzf "$archive" >/dev/null 2>&1; then
        echo "[nrbk] archive of volume $volume failed" >&2
        rm -f "$archive"
        return 1
    fi
    chmod 0600 "$archive"
    nrbk_write_manifest "$archive" "$volume" || { rm -f "$archive"; return 1; }
    nrbk_warn_secret_backup "$archive"
    printf '%s' "$archive"
}

nrbk_verify() {
    local archive="$1" manifest expected
    [ -s "$archive" ] || return 1
    tar -tzf "$archive" >/dev/null 2>&1 || return 1
    manifest="$(nrbk_manifest_path "$archive")"
    [ -f "$manifest" ] || return 0
    expected="$(jq -r '.artifact.sha256 // empty' "$manifest")"
    [ "$(bk_checksum "$archive")" = "$expected" ]
}

# Refuse to restore credentials the current secret cannot decrypt.
nrbk_secret_matches() {
    local archive="$1" manifest saved current
    manifest="$(nrbk_manifest_path "$archive")"
    [ -f "$manifest" ] || return 0
    saved="$(jq -r '.credentialSecret.sha256 // empty' "$manifest")"
    [ -n "$saved" ] || return 0
    current="$(nrbk_secret_fingerprint "${NRBK_STATE_ENV:-}")"
    [ "$saved" = "$current" ] && return 0
    echo "[nrbk] ${NRBK_SECRET_VAR} in '${NRBK_STATE_ENV:-<unset>}' differs from the one used at backup time." >&2
    echo "[nrbk] Restore deploy/state from the same backup first, or set NRBK_ALLOW_SECRET_MISMATCH=1 to lose the saved credentials." >&2
    [ "${NRBK_ALLOW_SECRET_MISMATCH:-0}" = "1" ]
}

# Installed modules stay, so a restore works offline; start.sh reinstalls
# only when they no longer match the restored package.json.
nrbk_replace_volume_contents() {
    local archive="$1" volume="$2"
    docker run --rm -i \
        -v "${volume}:/data" \
        "$NRBK_HELPER_IMAGE" \
        sh -c 'find /data -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .npm -exec rm -rf {} + && tar -xzf - -C /data' \
        < "$archive"
}

# nrbk_restore <archive> <volume> — caller stops Node-RED first.
nrbk_restore() {
    local archive="$1" volume="$2"
    nrbk_verify "$archive" || { echo "[nrbk] $archive failed verification" >&2; return 1; }
    nrbk_secret_matches "$archive" || return 1
    nrbk_replace_volume_contents "$archive" "$volume" || {
        echo "[nrbk] restore into volume $volume failed" >&2
        return 1
    }
}

# nrbk_rotate <dir> [<keep>] — keep the N newest archives (+ manifests).
nrbk_rotate() {
    local dir="$1" keep="${2:-${BACKUP_KEEP:-5}}"
    [ -d "$dir" ] || return 0
    find "$dir" -maxdepth 1 -type f -name 'nodered-*.tar.gz' -print 2>/dev/null |
        while IFS= read -r path; do
            printf '%s %s\n' "$(stat -c '%Y' "$path" 2>/dev/null || stat -f '%m' "$path")" "$path"
        done | sort -rn | awk -v keep="$keep" 'NR > keep {sub(/^[0-9]+ /, ""); print}' |
        while IFS= read -r stale; do
            rm -f "$stale" "$(nrbk_manifest_path "$stale")"
        done
}

# Run "$@" with Node-RED stopped: a clean stop flushes context to disk.
nrbk_with_nodered_stopped() {
    local project="$1"
    shift
    local container rc=0
    container="$(nrbk_running_container "$project")"
    if [ -n "$container" ]; then
        docker stop -t "$NRBK_STOP_TIMEOUT" "$container" >/dev/null || return 1
    fi
    "$@" || rc=$?
    if [ -n "$container" ]; then
        docker start "$container" >/dev/null || rc=1
    fi
    return "$rc"
}
