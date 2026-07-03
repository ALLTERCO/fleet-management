# shellcheck shell=bash
# state/retention.sh — TimescaleDB retention policy helpers.

_retention_to_days() {
    local raw="$1"
    local n="${raw% *}"
    local unit="${raw#* }"
    case "$unit" in
        second|seconds|minute|minutes|hour|hours) echo 1 ;;
        day|days)                                 echo "$n" ;;
        week|weeks)                               echo "$((n * 7))" ;;
        month|months)                             echo "$((n * 30))" ;;
        year|years)                               echo "$((n * 365))" ;;
        *) error "Unknown retention unit: '$unit'"; return 1 ;;
    esac
}

_widen_retention() {
    local label="$1" interval="$2"
    shift 2
    local current_days max_days v
    current_days=$(_retention_to_days "$interval") || return 1
    max_days="$current_days"
    for v in "$@"; do
        if [[ "$v" =~ ^[1-9][0-9]*$ ]] && [ "$v" -gt "$max_days" ]; then
            max_days="$v"
        fi
    done
    if [ "$max_days" -gt "$current_days" ]; then
        info "Widening Timescale ${label} retention: ${interval} → ${max_days} days (group-policy max)" >&2
        echo "${max_days} days"
    else
        echo "$interval"
    fi
}

apply_retention_policies() {
    local status_retention="${STATUS_RETENTION:-7 days}"
    local em_retention="${EM_STATS_RETENTION:-1 year}"
    local audit_retention="${AUDIT_LOG_RETENTION:-90 days}"
    # Empty = keep the 15-minute energy rollup forever (no retention policy).
    # Set a value (e.g. '7 years') once legal/commercial policy decides.
    local em_rollup_retention="${EM_ROLLUP_RETENTION:-}"

    local interval_re='^[0-9]+ (second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)$'
    for val in "$status_retention" "$em_retention" "$audit_retention"; do
        if ! echo "$val" | grep -qE "$interval_re"; then
            error "Invalid retention interval format: '$val' — must be '<number> <unit>' (e.g. '7 days')"
            return 1
        fi
    done
    if [ -n "$em_rollup_retention" ] && ! echo "$em_rollup_retention" | grep -qE "$interval_re"; then
        error "Invalid EM_ROLLUP_RETENTION: '$em_rollup_retention' — '<number> <unit>' or empty for forever"
        return 1
    fi

    status_retention=$(_widen_retention "status" "$status_retention" \
        "${FM_GROUP_POLICY_RETENTION_STANDARD_DAYS:-}" \
        "${FM_GROUP_POLICY_RETENTION_OPERATIONAL_DAYS:-}" \
        "${FM_GROUP_POLICY_RETENTION_CRITICAL_DAYS:-}" \
        "${FM_GROUP_POLICY_RETENTION_CUSTOM_DAYS:-}" \
        "${FM_GROUP_POLICY_RETENTION_FALLBACK_DAYS:-}") || return 1
    audit_retention=$(_widen_retention "audit" "$audit_retention" \
        "${FM_GROUP_POLICY_AUDIT_RETENTION_STANDARD_DAYS:-}" \
        "${FM_GROUP_POLICY_AUDIT_RETENTION_OPERATIONAL_DAYS:-}" \
        "${FM_GROUP_POLICY_AUDIT_RETENTION_CRITICAL_DAYS:-}" \
        "${FM_GROUP_POLICY_AUDIT_RETENTION_CUSTOM_DAYS:-}" \
        "${FM_GROUP_POLICY_AUDIT_RETENTION_FALLBACK_DAYS:-}") || return 1

    local rollup_note="forever"
    local rollup_action="NULL; -- 15-min rollup kept forever"
    if [ -n "$em_rollup_retention" ]; then
        rollup_note="$em_rollup_retention"
        rollup_action="PERFORM add_retention_policy('device_em.energy_15min', INTERVAL '${em_rollup_retention}');"
    fi

    info "Applying retention policies: status=${status_retention}, em=${em_retention}, audit=${audit_retention}, em_rollup=${rollup_note}"

    local sql
    sql=$(cat <<SQL
-- Auto-applied by deploy-public.sh
-- Idempotent: removes existing policies before re-adding

-- device.status — high-frequency telemetry (default: 24 hours)
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='device' AND table_name='status') THEN
    PERFORM remove_retention_policy('device.status', if_exists => true);
    PERFORM add_retention_policy('device.status', INTERVAL '${status_retention}');
    PERFORM remove_compression_policy('device.status', if_exists => true);
    PERFORM add_compression_policy('device.status', compress_created_before => INTERVAL '1 hour');
  END IF;
END \$\$;

-- device_em.stats — energy meter data (default: 1 year)
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='device_em' AND table_name='stats') THEN
    PERFORM remove_retention_policy('device_em.stats', if_exists => true);
    PERFORM add_retention_policy('device_em.stats', INTERVAL '${em_retention}');
    PERFORM remove_compression_policy('device_em.stats', if_exists => true);
    PERFORM add_compression_policy('device_em.stats', compress_created_before => INTERVAL '24 hours');
  END IF;
END \$\$;

-- device_em.energy_15min — long-term 15-minute rollup (default: kept forever)
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='device_em' AND table_name='energy_15min') THEN
    PERFORM remove_retention_policy('device_em.energy_15min', if_exists => true);
    ${rollup_action}
  END IF;
END \$\$;

-- logging.audit_log — user actions and RPC calls (default: 90 days)
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='logging' AND table_name='audit_log') THEN
    PERFORM remove_retention_policy('logging.audit_log', if_exists => true);
    PERFORM add_retention_policy('logging.audit_log', INTERVAL '${audit_retention}');
  END IF;
END \$\$;
SQL
)

    if echo "$sql" | docker exec -i "${COMPOSE_PROJECT_NAME}-fleet-db-1" \
        psql -U postgres -d fleet --no-psqlrc -q 2>/dev/null; then
        ok "Retention policies applied"
    else
        info "Retention policies will be applied after first restart (tables created during initial startup)"
    fi
}
