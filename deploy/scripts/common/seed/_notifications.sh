#!/usr/bin/env bash
# Notification destinations, email templates, and alert rules.

set -euo pipefail

_seed_notification_destinations() {
    info "Seeding notification destinations (channels)..."
    local destinations=(
        'Ops Email:Operational alerts go here'
        'Critical Pager:Pager / on-call for showstopper alerts'
    )
    local entry name desc body
    for entry in "${destinations[@]}"; do
        name="${entry%%:*}"
        desc="${entry#*:}"
        body=$(jq -cn --arg n "$name" --arg d "$desc" \
            '{name:$n, description:$d, enabled:true}')
        _seed_rpc_log 'notification.Destination.Create' "$body" "  $name"
    done
}

_seed_notification_templates() {
    info "Seeding notification email templates..."
    _seed_one_email_template \
        'Critical alert (HTML)' \
        '[CRITICAL] ${alert.name} on ${device.name}' \
        '<p><b>${alert.severity}</b>: ${alert.summary}</p><p>Device: ${device.name} @ ${device.location}</p>' \
        '${alert.severity}: ${alert.summary} on ${device.name}'
    _seed_one_email_template \
        'Battery digest' \
        'Battery report — ${digest.count} devices below threshold' \
        '<p>${digest.count} devices fell below the configured battery threshold in the last window.</p>' \
        '${digest.count} devices low on battery.'
}

_seed_one_email_template() {
    local name="$1" subj="$2" html="$3" txt="$4" body
    body=$(jq -nc \
        --arg n "$name" --arg s "$subj" --arg h "$html" --arg t "$txt" '
            {name:$n, subjectTemplate:$s, htmlTemplate:$h, textTemplate:$t}
        ')
    _seed_rpc_log 'notification.EmailTemplate.Create' "$body" "  $name"
}

_seed_alert_rules() {
    info "Seeding alert rules..."
    local dest_ids
    dest_ids=$(_seed_first_notification_dest_ids)
    if [ -z "$dest_ids" ]; then
        info "  skipped — no notification destinations to route to"
        return 0
    fi
    # Rule rows: "name|kind|severity|config_json". config_json is the
    # rule.config object — defaults to {} when omitted. Required fields per
    # rule kind live in backend/src/types/api/alert.ts (e.g. battery_below
    # requires thresholdPct).
    local rules=(
        'Device offline > 10m|device_offline|warning|{}'
        'Battery below 20%|battery_below|warning|{"thresholdPct":20}'
        'Flood detected|flood_alarm|critical|{}'
    )
    local entry name kind sev cfg
    for entry in "${rules[@]}"; do
        name="${entry%%|*}"
        kind=$(echo "$entry" | cut -d'|' -f2)
        sev=$(echo "$entry" | cut -d'|' -f3)
        cfg=$(echo "$entry" | cut -d'|' -f4-)
        _seed_one_alert_rule "$name" "$kind" "$sev" "$cfg" "$dest_ids"
    done
}

_seed_one_alert_rule() {
    local name="$1" kind="$2" sev="$3" cfg_json="$4" dest_ids="$5" payload
    payload=$(jq -nc --arg n "$name" --arg k "$kind" --arg s "$sev" \
        --argjson cfg "$cfg_json" \
        --argjson dids "[$dest_ids]" '
            {name:$n, kind:$k, severity:$s, config:$cfg, scope:{}, destinationGroupIds:$dids}
        ')
    _seed_rpc_log 'alert.Rule.Create' "$payload" "  $name"
}

_seed_first_notification_dest_ids() {
    local resp
    resp=$(_seed_rpc 'notification.Destination.List' '{"limit":50}' 2>/dev/null \
        || echo '{}')
    echo "$resp" | jq -r '.items[]? | .id' 2>/dev/null | head -n2 | paste -sd, -
}
