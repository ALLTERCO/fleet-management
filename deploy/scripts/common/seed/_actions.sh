#!/usr/bin/env bash
# Action variables + demo automation actions.

set -euo pipefail

# Variables used by automation actions to template payloads (${VAR_NAME}).
_seed_variables() {
    info "Seeding action variables..."
    local pairs=(
        'OFFICE_HOURS_START:08:00'
        'OFFICE_HOURS_END:19:00'
        'ALERT_EMAIL:ops@example.com'
        'SLACK_WEBHOOK:https://hooks.slack.com/services/REPLACE_ME'
    )
    local pair key value
    for pair in "${pairs[@]}"; do
        key="${pair%%:*}"
        value="${pair#*:}"
        if _seed_rpc 'Variables.Set' \
            "{\"key\":\"$key\",\"value\":\"$value\"}" >/dev/null 2>&1; then
            info "  $key"
        else
            info "  $key — skipped (Variables.Set unavailable or duplicate)"
        fi
    done
}

# Written through actions.rpc, the org-scoped registry used by the UI.
_seed_actions() {
    info "Seeding automation actions..."
    _seed_one_action \
        'Lights on at start of shift' \
        'fa-lightbulb' \
        '[{"id":1,"method":"Switch.Set","params":{"id":0,"on":true},"dst":[]}]'
    _seed_one_action \
        'Flood alert to ops' \
        'fa-water' \
        '[{"id":1,"method":"Shelly.GetStatus","params":{},"dst":[]}]'
}

_seed_one_action() {
    local name="$1" icon="$2" actions="$3" body
    body=$(jq -nc --arg n "$name" --arg i "$icon" --argjson a "$actions" '
        {registry:"actions", key:"rpc", value:{name:$n, icon:$i, actions:$a}}
    ')
    if _seed_rpc 'Storage.SetItem' "$body" >/dev/null 2>&1; then
        info "  $name"
    else
        info "  $name — skipped"
    fi
}
