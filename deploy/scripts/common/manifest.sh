#!/usr/bin/env bash
# Declarative deployment state — single source of truth for install + update.
# Schema: docs/architecture/update-command-design.md §3.

# In its own subdir so the FM container can bind-mount it read-only without the
# sibling secrets (fm-runtime.env, machinekey, …) that live in state/.
manifest_path() {
    printf '%s' "${MANIFEST_PATH:-${STATE_DIR:-./state}/contract/manifest.json}"
}

manifest_history_dir() {
    printf '%s' "${MANIFEST_HISTORY_DIR:-${STATE_DIR:-./state}/manifest-history}"
}

# Build a fresh manifest. Args: env mode ssl_mode routing
manifest_init() {
    local env="$1" mode="$2" ssl_mode="${3:-}" routing="${4:-}"
    local deployment_id ts
    deployment_id="$(_manifest_uuid)"
    ts="$(_manifest_iso8601)"
    jq -n \
        --arg deployment_id "$deployment_id" \
        --arg env           "$env" \
        --arg mode          "$mode" \
        --arg ssl_mode      "$ssl_mode" \
        --arg routing       "$routing" \
        --arg ts            "$ts" \
        '{
            manifest_version: 1,
            deployment_id: $deployment_id,
            env: $env,
            mode: $mode,
            ssl_mode: $ssl_mode,
            routing: $routing,
            topology: {},
            shared_services: {},
            clients: {},
            history: [{revision: "rev-0001", at: $ts, action: "install", scope: "all"}]
        }'
}

manifest_read() {
    local path; path="$(manifest_path)"
    if [ ! -f "$path" ]; then
        echo "manifest not found: $path" >&2
        return 1
    fi
    if ! jq . "$path" 2>/dev/null; then
        echo "manifest is corrupt: $path" >&2
        echo "  Recover from snapshot in $(manifest_history_dir)/, then retry." >&2
        return 1
    fi
}

# Validates the manifest if it exists. Tolerates legacy (pre-manifest) installs
# by no-op-passing when the file is absent. Caller-facing helper for command
# entry points — fails loudly so a corrupt manifest never produces silently
# empty reads downstream.
manifest_require_valid() {
    [ -f "$(manifest_path)" ] || return 0
    manifest_read >/dev/null
}

# Validates JSON, writes atomically (tmpfile + rename), chmod 0644.
# Invalid input leaves any existing manifest untouched. 0644 (not 0600) so the
# FM container (runs as node) can read it through the read-only contract mount —
# the manifest holds no secrets (version, mode, checks, history).
manifest_write() {
    local content="$1"
    local path tmp
    path="$(manifest_path)"
    mkdir -p "$(dirname "$path")"
    tmp="$(mktemp "${path}.XXXXXX")" || return 1
    if ! printf '%s\n' "$content" | jq . > "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        echo "manifest_write: invalid JSON" >&2
        return 1
    fi
    chmod 0644 "$tmp"
    mv "$tmp" "$path"
}

# Next revision id based on last history entry; falls back to rev-0001.
manifest_revision_next() {
    local last num
    last="$(manifest_read 2>/dev/null | jq -r '.history[-1].revision // "rev-0000"')"
    num="${last#rev-}"
    num=$((10#$num + 1))
    printf 'rev-%04d' "$num"
}

# Snapshot current manifest into history/<revision>.json for rollback.
# Pass the upcoming revision id (so rapid sequential snapshots don't collide on
# the same prior-revision filename). If omitted, falls back to the prior
# revision (legacy callers).
manifest_snapshot() {
    local upcoming_revision="${1:-}"
    local content revision dir
    content="$(manifest_read)" || return 1
    if [ -n "$upcoming_revision" ]; then
        revision="$upcoming_revision"
    else
        revision="$(printf '%s' "$content" | jq -r '.history[-1].revision')"
    fi
    dir="$(manifest_history_dir)"
    mkdir -p "$dir"
    printf '%s\n' "$content" > "$dir/${revision}.json"
    chmod 0600 "$dir/${revision}.json"
}

# Set a jq-path to a string value (e.g. .clients."acme".image = "v1.0").
manifest_set_field() {
    local path="$1" value="$2"
    local current updated
    current="$(manifest_read)" || return 1
    updated="$(printf '%s' "$current" | jq --arg v "$value" "${path} = \$v")"
    manifest_write "$updated"
}

# Read a jq-path as raw string. Returns empty for missing.
manifest_get_field() {
    local path="$1"
    manifest_read 2>/dev/null | jq -r "${path} // empty"
}

# Append entry to .history. extra_json is a JSON object merged into the entry.
manifest_add_history() {
    local revision="$1" action="$2" scope="$3" extra_json="${4:-{\}}"
    local ts current updated
    ts="$(_manifest_iso8601)"
    current="$(manifest_read)" || return 1
    updated="$(printf '%s' "$current" | jq \
        --arg revision "$revision" \
        --arg at       "$ts" \
        --arg action   "$action" \
        --arg scope    "$scope" \
        --argjson extra "$extra_json" \
        '.history += [{revision: $revision, at: $at, action: $action, scope: $scope} + $extra]')"
    manifest_write "$updated"
}

_manifest_uuid() {
    if command -v uuidgen >/dev/null 2>&1; then
        uuidgen | tr 'A-Z' 'a-z'
    else
        openssl rand -hex 16 | sed 's/\(........\)\(....\)\(....\)\(....\)\(.*\)/\1-\2-\3-\4-\5/'
    fi
}

_manifest_iso8601() {
    date -u +%Y-%m-%dT%H:%M:%SZ
}
