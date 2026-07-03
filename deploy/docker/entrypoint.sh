#!/bin/sh
set -e

# Trust the local CA for outbound HTTPS (Zitadel introspection via the
# external URL). Set NODE_EXTRA_CA_CERTS so Node's fetch validates self-signed.
LOCAL_CA="${FM_LOCAL_CA_DIR:-/app/state/tls}/ca.crt"
if [ -f "$LOCAL_CA" ]; then
  export NODE_EXTRA_CA_CERTS="$LOCAL_CA"
  if command -v update-ca-certificates >/dev/null 2>&1; then
    cp "$LOCAL_CA" /usr/local/share/ca-certificates/fm-local-ca.crt
    update-ca-certificates >/dev/null 2>&1 || true
  fi
fi

# Seed default assets (backgrounds, profile pics) into the uploads volume.
# Copies only files that don't already exist — user uploads are never overwritten.
SEED_DIR="/app/backend/uploads-seed"
UPLOADS_DIR="/app/backend/uploads"
if [ -d "$SEED_DIR" ]; then
  SEED_COUNT=0
  # POSIX-safe iteration: redirect from a tempfile (not a pipe) so the
  # SEED_COUNT increment happens in the same shell. Seed paths are
  # controlled inputs (developer-provided), so no newlines expected.
  SEED_LIST="$(mktemp)"
  find "$SEED_DIR" -type f > "$SEED_LIST"
  while IFS= read -r src; do
    rel="${src#"$SEED_DIR"/}"
    dst="$UPLOADS_DIR/$rel"
    if [ ! -f "$dst" ]; then
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst"
      SEED_COUNT=$((SEED_COUNT + 1))
    fi
  done < "$SEED_LIST"
  rm -f "$SEED_LIST"
  echo "[entrypoint] Seed assets: $SEED_COUNT new files copied to uploads volume"
fi

# Generate frontend runtime config from environment variables.
# Written to /tmp (writable tmpfs) — symlinked from /app/frontend/dist/runtime-config.js
CONFIG_FILE="/tmp/runtime-config.js"

# Debug/perf settings (default: off in production, overridable per environment)
# Validate boolean env vars — only allow true/false to prevent JS injection.
# Unknown input forces 'false' (loud) to surface typos in env files.
validate_bool() {
  case "$1" in
    true|false) echo "$1" ;;
    *) echo "[entrypoint] WARN: bool '$1' invalid; forcing 'false'" >&2
       echo "false" ;;
  esac
}
FM_DEBUG_DEFAULT="$(validate_bool "${FM_DEBUG_DEFAULT:-false}")"
FM_PERF_TRACING="$(validate_bool "${FM_PERF_TRACING:-false}")"
FM_OBSERVABILITY="$(validate_bool "${FM_OBSERVABILITY:-false}")"

# Positive-integer validator; rejects leading-zero (octal) and >safe-int/2.
# Reject on length > 16 digits so 64-bit-incapable shells never compare.
validate_uint() {
  case "$1" in
    ''|*[!0-9]*|0|0[0-9]*)
      echo "[entrypoint] WARN: uint '$1' invalid; falling back to $2" >&2
      echo "$2"; return ;;
  esac
  case ${#1} in
    1[7-9]|2[0-9]|[3-9][0-9]|*[0-9][0-9][0-9])
      echo "[entrypoint] WARN: uint '$1' too long; falling back to $2" >&2
      echo "$2"; return ;;
  esac
  if [ "$1" -gt 4503599627370495 ]; then
    echo "[entrypoint] WARN: uint '$1' exceeds safe-int; falling back to $2" >&2
    echo "$2"
  else
    echo "$1"
  fi
}
FM_LOG_BUFFER_MAX="$(validate_uint "${FM_LOG_BUFFER_MAX:-2000}" "2000")"
FM_LOG_CATEGORY_MAX="$(validate_uint "${FM_LOG_CATEGORY_MAX:-100}" "100")"
FM_AUDIT_PAGE_SIZE="$(validate_uint "${FM_AUDIT_PAGE_SIZE:-100}" "100")"
FM_AUDIT_PAYLOAD_PREVIEW_MAX="$(validate_uint "${FM_AUDIT_PAYLOAD_PREVIEW_MAX:-80}" "80")"
FM_ZITADEL_PASSWORD_MIN_LENGTH="$(validate_uint "${FM_ZITADEL_PASSWORD_MIN_LENGTH:-8}" "8")"
FM_AUTHZ_UNUSED_THRESHOLD_DAYS="$(validate_uint "${FM_AUTHZ_UNUSED_THRESHOLD_DAYS:-90}" "90")"

# Hour 0..23 (validate_uint rejects 0, which is a valid midnight).
validate_hour() {
  case "$1" in
    ''|*[!0-9]*)
      echo "[entrypoint] WARN: hour '$1' invalid; falling back to $2" >&2
      echo "$2"; return ;;
  esac
  if [ "$1" -ge 0 ] && [ "$1" -le 23 ]; then
    echo "$1"
  else
    echo "[entrypoint] WARN: hour '$1' out of [0,23]; falling back to $2" >&2
    echo "$2"
  fi
}

# CSV of positive ints. Rejects the whole value on any bad token so no
# partial config survives. Subshell scopes IFS (POSIX sh has no `local`).
validate_csv_uints() {
  (
    IFS=','
    out=""
    for part in $1; do
      part="${part# }"; part="${part% }"
      case "$part" in
        ''|*[!0-9]*|0|0[0-9]*)
          echo "[entrypoint] WARN: csv-uint token '$part' invalid in '$1'; falling back to $2" >&2
          echo "$2"; exit 0 ;;
      esac
      out="${out:+$out,}$part"
    done
    if [ -n "$out" ]; then
      echo "$out"
    else
      echo "[entrypoint] WARN: csv-uint '$1' empty; falling back to $2" >&2
      echo "$2"
    fi
  )
}

# Frontend UI tunables — env files own the values; scripts fail fast on miss.
: "${FM_UI_NOW_TICKER_MS:?FM_UI_NOW_TICKER_MS must be set (see deploy/env/.env.example)}"
: "${FM_UI_LIST_SKELETON_COUNT:?FM_UI_LIST_SKELETON_COUNT must be set}"
: "${FM_UI_ALERT_TIMER_CRITICAL_AMBER_MINS:?FM_UI_ALERT_TIMER_CRITICAL_AMBER_MINS must be set}"
: "${FM_UI_ALERT_TIMER_CRITICAL_DANGER_MINS:?FM_UI_ALERT_TIMER_CRITICAL_DANGER_MINS must be set}"
: "${FM_UI_ALERT_TIMER_WARNING_AMBER_MINS:?FM_UI_ALERT_TIMER_WARNING_AMBER_MINS must be set}"
: "${FM_UI_ALERT_TIMER_WARNING_DANGER_MINS:?FM_UI_ALERT_TIMER_WARNING_DANGER_MINS must be set}"
: "${FM_UI_ALERT_TIMER_INFO_AMBER_MINS:?FM_UI_ALERT_TIMER_INFO_AMBER_MINS must be set}"
: "${FM_UI_ALERT_TIMER_INFO_DANGER_MINS:?FM_UI_ALERT_TIMER_INFO_DANGER_MINS must be set}"
: "${FM_UI_SILENCE_PRESET_MINUTES:?FM_UI_SILENCE_PRESET_MINUTES must be set}"
: "${FM_UI_SILENCE_TOMORROW_HOUR:?FM_UI_SILENCE_TOMORROW_HOUR must be set}"
: "${FM_UI_TOAST_DEFAULT_MS:?FM_UI_TOAST_DEFAULT_MS must be set}"
: "${FM_UI_TOAST_ACTION_MS:?FM_UI_TOAST_ACTION_MS must be set}"
: "${FM_UI_TOAST_MAX_STACK:?FM_UI_TOAST_MAX_STACK must be set}"
: "${FM_UI_URL_SYNC_DEBOUNCE_MS:?FM_UI_URL_SYNC_DEBOUNCE_MS must be set}"
: "${FM_UI_DUPLICATE_CHECK_DEBOUNCE_MS:?FM_UI_DUPLICATE_CHECK_DEBOUNCE_MS must be set}"
: "${FM_UI_TEMPLATE_PREVIEW_DEBOUNCE_MS:?FM_UI_TEMPLATE_PREVIEW_DEBOUNCE_MS must be set}"
: "${FM_UI_OPTIMISTIC_FLASH_MS:?FM_UI_OPTIMISTIC_FLASH_MS must be set}"
: "${FM_UI_OPTIMISTIC_RECONCILE_TIMEOUT_MS:?FM_UI_OPTIMISTIC_RECONCILE_TIMEOUT_MS must be set}"
: "${FM_UI_OPTIMISTIC_REAPER_MS:?FM_UI_OPTIMISTIC_REAPER_MS must be set}"
: "${FM_UI_SEARCH_THRESHOLD:?FM_UI_SEARCH_THRESHOLD must be set}"
: "${FM_UI_SEARCH_IGNORE_LOCATION:?FM_UI_SEARCH_IGNORE_LOCATION must be set}"
: "${FM_UI_FIRINGS_PAGE_SIZE:?FM_UI_FIRINGS_PAGE_SIZE must be set}"
: "${FM_UI_GROUP_ACTIVITY_PAGE_SIZE:?FM_UI_GROUP_ACTIVITY_PAGE_SIZE must be set}"
: "${FM_UI_EM_NET_PREVIEW_ROWS:?FM_UI_EM_NET_PREVIEW_ROWS must be set}"
: "${FM_UI_EM_NET_PAGE_LIMIT:?FM_UI_EM_NET_PAGE_LIMIT must be set}"
: "${FM_UI_OPS_REFRESH_MS:?FM_UI_OPS_REFRESH_MS must be set}"
: "${FM_UI_MAP_STYLE_URL:?FM_UI_MAP_STYLE_URL must be set}"
: "${FM_UI_MAP_SINGLE_PIN_ZOOM:?FM_UI_MAP_SINGLE_PIN_ZOOM must be set}"
: "${FM_UI_MAP_DETAIL_ZOOM:?FM_UI_MAP_DETAIL_ZOOM must be set}"
: "${FM_UI_MAP_FIT_PADDING_PX:?FM_UI_MAP_FIT_PADDING_PX must be set}"
: "${FM_UI_MAP_FIT_MAX_ZOOM:?FM_UI_MAP_FIT_MAX_ZOOM must be set}"
: "${FM_UI_MAP_FLY_DURATION_MS:?FM_UI_MAP_FLY_DURATION_MS must be set}"
: "${FM_UI_MAP_3D_PITCH_DEG:?FM_UI_MAP_3D_PITCH_DEG must be set}"
: "${FM_UI_MAP_EXTRUSION_MIN_ZOOM:?FM_UI_MAP_EXTRUSION_MIN_ZOOM must be set}"
: "${FM_UI_FLOORPLAN_HEIGHT_PX:?FM_UI_FLOORPLAN_HEIGHT_PX must be set}"
: "${FM_UI_FLOORPLAN_MOBILE_HEIGHT_PX:?FM_UI_FLOORPLAN_MOBILE_HEIGHT_PX must be set}"
: "${FM_UI_REPLAY_TRAIL_LENGTH_SEC:?FM_UI_REPLAY_TRAIL_LENGTH_SEC must be set}"
: "${FM_UI_MAP_OVERVIEW_ZOOM:?FM_UI_MAP_OVERVIEW_ZOOM must be set}"
: "${FM_UI_MAP_PITCH_EASE_DURATION_MS:?FM_UI_MAP_PITCH_EASE_DURATION_MS must be set}"
: "${FM_UI_TOPOLOGY_ANIMATION_DURATION_MS:?FM_UI_TOPOLOGY_ANIMATION_DURATION_MS must be set}"
: "${FM_UI_TOPOLOGY_NODE_REPULSION:?FM_UI_TOPOLOGY_NODE_REPULSION must be set}"
: "${FM_UI_TOPOLOGY_IDEAL_EDGE_LENGTH:?FM_UI_TOPOLOGY_IDEAL_EDGE_LENGTH must be set}"
: "${FM_UI_TOPOLOGY_EDGE_ELASTICITY:?FM_UI_TOPOLOGY_EDGE_ELASTICITY must be set}"
: "${FM_UI_TOPOLOGY_GRAVITY:?FM_UI_TOPOLOGY_GRAVITY must be set}"
: "${FM_UI_TOPOLOGY_TILE:?FM_UI_TOPOLOGY_TILE must be set}"
: "${FM_UI_SHORTCUT_HELP:?FM_UI_SHORTCUT_HELP must be set}"
: "${FM_UI_SHORTCUT_CLOSE_INSPECTOR:?FM_UI_SHORTCUT_CLOSE_INSPECTOR must be set}"
: "${FM_UI_SHORTCUT_SEARCH_FOCUS:?FM_UI_SHORTCUT_SEARCH_FOCUS must be set}"
: "${FM_UI_SHORTCUT_DASHBOARD_UNDO:?FM_UI_SHORTCUT_DASHBOARD_UNDO must be set}"
: "${FM_UI_SHORTCUT_DASHBOARD_REDO:?FM_UI_SHORTCUT_DASHBOARD_REDO must be set}"
: "${FM_UI_SHORTCUT_LOGS_FOCUS:?FM_UI_SHORTCUT_LOGS_FOCUS must be set}"
: "${FM_UI_SHORTCUT_LOGS_CLEAR:?FM_UI_SHORTCUT_LOGS_CLEAR must be set}"
: "${FM_UI_SHORTCUT_LOGS_CLEAR_SEARCH:?FM_UI_SHORTCUT_LOGS_CLEAR_SEARCH must be set}"
# Validators reject malformed input — fall back to the documented default
# so a typo in env doesn't crash the container, but a missing var does.
FM_UI_NOW_TICKER_MS="$(validate_uint "$FM_UI_NOW_TICKER_MS" "30000")"
FM_UI_LIST_SKELETON_COUNT="$(validate_uint "$FM_UI_LIST_SKELETON_COUNT" "4")"
FM_UI_ALERT_TIMER_CRITICAL_AMBER_MINS="$(validate_uint "$FM_UI_ALERT_TIMER_CRITICAL_AMBER_MINS" "5")"
FM_UI_ALERT_TIMER_CRITICAL_DANGER_MINS="$(validate_uint "$FM_UI_ALERT_TIMER_CRITICAL_DANGER_MINS" "15")"
FM_UI_ALERT_TIMER_WARNING_AMBER_MINS="$(validate_uint "$FM_UI_ALERT_TIMER_WARNING_AMBER_MINS" "30")"
FM_UI_ALERT_TIMER_WARNING_DANGER_MINS="$(validate_uint "$FM_UI_ALERT_TIMER_WARNING_DANGER_MINS" "120")"
FM_UI_ALERT_TIMER_INFO_AMBER_MINS="$(validate_uint "$FM_UI_ALERT_TIMER_INFO_AMBER_MINS" "120")"
FM_UI_ALERT_TIMER_INFO_DANGER_MINS="$(validate_uint "$FM_UI_ALERT_TIMER_INFO_DANGER_MINS" "480")"
FM_UI_SILENCE_PRESET_MINUTES="$(validate_csv_uints "$FM_UI_SILENCE_PRESET_MINUTES" "15,60,240,480,1440")"
FM_UI_SILENCE_TOMORROW_HOUR="$(validate_hour "$FM_UI_SILENCE_TOMORROW_HOUR" "9")"
FM_UI_TOAST_DEFAULT_MS="$(validate_uint "$FM_UI_TOAST_DEFAULT_MS" "5000")"
FM_UI_TOAST_ACTION_MS="$(validate_uint "$FM_UI_TOAST_ACTION_MS" "8000")"
FM_UI_TOAST_MAX_STACK="$(validate_uint "$FM_UI_TOAST_MAX_STACK" "5")"
FM_UI_URL_SYNC_DEBOUNCE_MS="$(validate_uint "$FM_UI_URL_SYNC_DEBOUNCE_MS" "300")"
FM_UI_DUPLICATE_CHECK_DEBOUNCE_MS="$(validate_uint "$FM_UI_DUPLICATE_CHECK_DEBOUNCE_MS" "400")"
FM_UI_TEMPLATE_PREVIEW_DEBOUNCE_MS="$(validate_uint "$FM_UI_TEMPLATE_PREVIEW_DEBOUNCE_MS" "300")"
FM_UI_OPTIMISTIC_FLASH_MS="$(validate_uint "$FM_UI_OPTIMISTIC_FLASH_MS" "220")"
FM_UI_OPTIMISTIC_RECONCILE_TIMEOUT_MS="$(validate_uint "$FM_UI_OPTIMISTIC_RECONCILE_TIMEOUT_MS" "3000")"
FM_UI_OPTIMISTIC_REAPER_MS="$(validate_uint "$FM_UI_OPTIMISTIC_REAPER_MS" "60000")"
# Fuse.js threshold: float in [0.0, 1.0]. Cap at 4 decimals — plenty.
validate_threshold() {
  case "$1" in
    0|1) echo "$1" ;;
    0.[0-9]|0.[0-9][0-9]|0.[0-9][0-9][0-9]|0.[0-9][0-9][0-9][0-9]) echo "$1" ;;
    1.0|1.00|1.000|1.0000) echo "$1" ;;
    *) echo "[entrypoint] WARN: threshold '$1' invalid; falling back to $2" >&2
       echo "$2" ;;
  esac
}
# Bool validator with an explicit fallback arg — validate_bool forces
# 'false' on unknown input, which would silently break true-default
# settings like ignoreLocation.
validate_bool_fb() {
  case "$1" in
    true|false) echo "$1" ;;
    *) echo "[entrypoint] WARN: bool '$1' invalid; falling back to $2" >&2
       echo "$2" ;;
  esac
}
FM_UI_SEARCH_THRESHOLD="$(validate_threshold "$FM_UI_SEARCH_THRESHOLD" "0.4")"
FM_UI_SEARCH_IGNORE_LOCATION="$(validate_bool_fb "$FM_UI_SEARCH_IGNORE_LOCATION" "true")"
FM_UI_FIRINGS_PAGE_SIZE="$(validate_uint "$FM_UI_FIRINGS_PAGE_SIZE" "100")"
FM_UI_GROUP_ACTIVITY_PAGE_SIZE="$(validate_uint "$FM_UI_GROUP_ACTIVITY_PAGE_SIZE" "200")"
FM_UI_EM_NET_PREVIEW_ROWS="$(validate_uint "$FM_UI_EM_NET_PREVIEW_ROWS" "12")"
FM_UI_EM_NET_PAGE_LIMIT="$(validate_uint "$FM_UI_EM_NET_PAGE_LIMIT" "200")"
FM_UI_OPS_REFRESH_MS="$(validate_uint "$FM_UI_OPS_REFRESH_MS" "5000")"

# Map / visualization tunables. URL sanitizer: must start with http(s)://
# and contain no JS-literal-breaking chars (quotes, backslash, angle brackets,
# control chars). Falls back loudly so a mis-typed URL is visible at boot.
validate_url() {
  case "$1" in
    https://*|http://*) ;;
    *) echo "[entrypoint] WARN: $3 not http(s) URL; falling back to default" >&2
       echo "$2"; return ;;
  esac
  case "$1" in
    *[\"\\\<\>\`]*|*[![:print:]]*)
       echo "[entrypoint] WARN: $3 contains forbidden chars; falling back" >&2
       echo "$2"; return ;;
  esac
  echo "$1"
}
FM_UI_MAP_STYLE_URL="$(validate_url "$FM_UI_MAP_STYLE_URL" \
  "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json" \
  "FM_UI_MAP_STYLE_URL")"
FM_UI_MAP_SINGLE_PIN_ZOOM="$(validate_uint "$FM_UI_MAP_SINGLE_PIN_ZOOM" "11")"
FM_UI_MAP_DETAIL_ZOOM="$(validate_uint "$FM_UI_MAP_DETAIL_ZOOM" "15")"
FM_UI_MAP_FIT_PADDING_PX="$(validate_uint "$FM_UI_MAP_FIT_PADDING_PX" "48")"
FM_UI_MAP_FIT_MAX_ZOOM="$(validate_uint "$FM_UI_MAP_FIT_MAX_ZOOM" "12")"
FM_UI_MAP_FLY_DURATION_MS="$(validate_uint "$FM_UI_MAP_FLY_DURATION_MS" "600")"
FM_UI_MAP_3D_PITCH_DEG="$(validate_uint "$FM_UI_MAP_3D_PITCH_DEG" "55")"
FM_UI_MAP_EXTRUSION_MIN_ZOOM="$(validate_uint "$FM_UI_MAP_EXTRUSION_MIN_ZOOM" "14")"
FM_UI_FLOORPLAN_HEIGHT_PX="$(validate_uint "$FM_UI_FLOORPLAN_HEIGHT_PX" "480")"
FM_UI_FLOORPLAN_MOBILE_HEIGHT_PX="$(validate_uint "$FM_UI_FLOORPLAN_MOBILE_HEIGHT_PX" "360")"
FM_UI_REPLAY_TRAIL_LENGTH_SEC="$(validate_uint "$FM_UI_REPLAY_TRAIL_LENGTH_SEC" "300")"
FM_UI_MAP_OVERVIEW_ZOOM="$(validate_uint "$FM_UI_MAP_OVERVIEW_ZOOM" "2")"
FM_UI_MAP_PITCH_EASE_DURATION_MS="$(validate_uint "$FM_UI_MAP_PITCH_EASE_DURATION_MS" "500")"
FM_UI_TOPOLOGY_ANIMATION_DURATION_MS="$(validate_uint "$FM_UI_TOPOLOGY_ANIMATION_DURATION_MS" "800")"
FM_UI_TOPOLOGY_NODE_REPULSION="$(validate_uint "$FM_UI_TOPOLOGY_NODE_REPULSION" "4500")"
FM_UI_TOPOLOGY_IDEAL_EDGE_LENGTH="$(validate_uint "$FM_UI_TOPOLOGY_IDEAL_EDGE_LENGTH" "80")"
FM_UI_TOPOLOGY_EDGE_ELASTICITY="$(validate_threshold "$FM_UI_TOPOLOGY_EDGE_ELASTICITY" "0.45")"
FM_UI_TOPOLOGY_GRAVITY="$(validate_threshold "$FM_UI_TOPOLOGY_GRAVITY" "0.25")"
FM_UI_TOPOLOGY_TILE="$(validate_bool_fb "$FM_UI_TOPOLOGY_TILE" "true")"

# Shortcut DSL sanitizer — blocks injection into the JS literal below.
validate_shortcut() {
  case "$1" in
    '') echo "" ;;
    *[!a-z0-9+?!@#$%^\&*]*)
       echo "[entrypoint] WARN: shortcut '$1' has invalid chars; falling back to $2" >&2
       echo "$2" ;;
    *) echo "$1" ;;
  esac
}
FM_UI_SHORTCUT_HELP="$(validate_shortcut "$FM_UI_SHORTCUT_HELP" "?")"
FM_UI_SHORTCUT_CLOSE_INSPECTOR="$(validate_shortcut "$FM_UI_SHORTCUT_CLOSE_INSPECTOR" "escape")"
FM_UI_SHORTCUT_SEARCH_FOCUS="$(validate_shortcut "$FM_UI_SHORTCUT_SEARCH_FOCUS" "mod+k")"
FM_UI_SHORTCUT_DASHBOARD_UNDO="$(validate_shortcut "$FM_UI_SHORTCUT_DASHBOARD_UNDO" "mod+z")"
FM_UI_SHORTCUT_DASHBOARD_REDO="$(validate_shortcut "$FM_UI_SHORTCUT_DASHBOARD_REDO" "mod+shift+z")"
FM_UI_SHORTCUT_LOGS_FOCUS="$(validate_shortcut "$FM_UI_SHORTCUT_LOGS_FOCUS" "mod+k")"
FM_UI_SHORTCUT_LOGS_CLEAR="$(validate_shortcut "$FM_UI_SHORTCUT_LOGS_CLEAR" "mod+l")"
FM_UI_SHORTCUT_LOGS_CLEAR_SEARCH="$(validate_shortcut "$FM_UI_SHORTCUT_LOGS_CLEAR_SEARCH" "escape")"

# Allow only slash-prefixed, word/char paths — prevents JS string injection
# through these env vars (they land inside a JS object literal).
validate_path() {
  case "$1" in
    /|/*)
      if echo "$1" | grep -qE '^/[a-zA-Z0-9/_-]*$'; then
        echo "$1"; return
      fi ;;
  esac
  echo "[entrypoint] WARN: path '$1' invalid; falling back to $2" >&2
  echo "$2"
}
FM_RPC_BASE_URL="$(validate_path "${FM_RPC_BASE_URL:-/rpc}" "/rpc")"
FM_WS_BASE_URL="$(validate_path "${FM_WS_BASE_URL:-/}" "/")"
FM_RPC_AUDIT_LOG_PATH="$(validate_path "${FM_RPC_AUDIT_LOG_PATH:-/monitoring/audit-log}" "/monitoring/audit-log")"

validate_url_or_path() {
  if [ -z "$1" ]; then
    echo "$2"; return
  fi
  case "$1" in
    /|/*)
      if echo "$1" | grep -qE '^/[a-zA-Z0-9/_.,?=&%:-]*$'; then
        echo "$1"; return
      fi ;;
    http://*|https://*)
      if echo "$1" | grep -qE '^https?://[a-zA-Z0-9._:-]+(/[a-zA-Z0-9/_.,?=&%:-]*)?$'; then
        echo "$1"; return
      fi ;;
  esac
  echo "[entrypoint] WARN: URL/path '$1' invalid; falling back to $2" >&2
  echo "$2"
}
FM_NODE_RED_URL="$(validate_url_or_path "${FM_NODE_RED_URL:-/node-red/red}" "/node-red/red")"
FM_NODE_RED_SESSION_URL="$(validate_url_or_path "${FM_NODE_RED_SESSION_URL:-}" "")"
FM_NODE_RED_ENABLED="$(validate_bool "${FM_NODE_RED_ENABLED:-false}")"
FM_DEV_MODE_JS="$(validate_bool "${FM_DEV_MODE:-false}")"

cat > "$CONFIG_FILE" <<JSEOF
window.__FM_RUNTIME_CONFIG__ = {
  devMode: $FM_DEV_MODE_JS,
  debugDefault: $FM_DEBUG_DEFAULT,
  perfTracing: $FM_PERF_TRACING,
  observability: $FM_OBSERVABILITY,
  rpcBaseUrl: "$FM_RPC_BASE_URL",
  wsBaseUrl: "$FM_WS_BASE_URL",
  nodeRedEnabled: $FM_NODE_RED_ENABLED,
  nodeRedUrl: "$FM_NODE_RED_URL",
  nodeRedSessionUrl: "$FM_NODE_RED_SESSION_URL",
  logBufferMax: $FM_LOG_BUFFER_MAX,
  logCategoryMax: $FM_LOG_CATEGORY_MAX,
  auditPageSize: $FM_AUDIT_PAGE_SIZE,
  auditPayloadPreviewMax: $FM_AUDIT_PAYLOAD_PREVIEW_MAX,
  rpcAuditLogPath: "$FM_RPC_AUDIT_LOG_PATH",
  zitadelPasswordMinLength: $FM_ZITADEL_PASSWORD_MIN_LENGTH,
  authzUnusedThresholdDays: $FM_AUTHZ_UNUSED_THRESHOLD_DAYS,
  ui: {
    nowTickerMs: $FM_UI_NOW_TICKER_MS,
    listSkeletonCount: $FM_UI_LIST_SKELETON_COUNT,
    alertTimer: {
      critical: {amberMins: $FM_UI_ALERT_TIMER_CRITICAL_AMBER_MINS, dangerMins: $FM_UI_ALERT_TIMER_CRITICAL_DANGER_MINS},
      warning: {amberMins: $FM_UI_ALERT_TIMER_WARNING_AMBER_MINS, dangerMins: $FM_UI_ALERT_TIMER_WARNING_DANGER_MINS},
      info: {amberMins: $FM_UI_ALERT_TIMER_INFO_AMBER_MINS, dangerMins: $FM_UI_ALERT_TIMER_INFO_DANGER_MINS}
    },
    silence: {
      presetMinutes: [$FM_UI_SILENCE_PRESET_MINUTES],
      tomorrowHour: $FM_UI_SILENCE_TOMORROW_HOUR
    },
    toast: {
      defaultMs: $FM_UI_TOAST_DEFAULT_MS,
      actionMs: $FM_UI_TOAST_ACTION_MS,
      maxStack: $FM_UI_TOAST_MAX_STACK
    },
    search: {
      threshold: $FM_UI_SEARCH_THRESHOLD,
      ignoreLocation: $FM_UI_SEARCH_IGNORE_LOCATION
    },
    urlSyncDebounceMs: $FM_UI_URL_SYNC_DEBOUNCE_MS,
    duplicateCheckDebounceMs: $FM_UI_DUPLICATE_CHECK_DEBOUNCE_MS,
    templatePreviewDebounceMs: $FM_UI_TEMPLATE_PREVIEW_DEBOUNCE_MS,
    optimisticFlashMs: $FM_UI_OPTIMISTIC_FLASH_MS,
    optimisticReconcileTimeoutMs: $FM_UI_OPTIMISTIC_RECONCILE_TIMEOUT_MS,
    optimisticReaperMs: $FM_UI_OPTIMISTIC_REAPER_MS,
    firingsPageSize: $FM_UI_FIRINGS_PAGE_SIZE,
    groupActivityPageSize: $FM_UI_GROUP_ACTIVITY_PAGE_SIZE,
    emNetPreviewRows: $FM_UI_EM_NET_PREVIEW_ROWS,
    emNetPageLimit: $FM_UI_EM_NET_PAGE_LIMIT,
    opsRefreshMs: $FM_UI_OPS_REFRESH_MS,
    mapStyleUrl: "$FM_UI_MAP_STYLE_URL",
    mapSinglePinZoom: $FM_UI_MAP_SINGLE_PIN_ZOOM,
    mapDetailZoom: $FM_UI_MAP_DETAIL_ZOOM,
    mapFitPaddingPx: $FM_UI_MAP_FIT_PADDING_PX,
    mapFitMaxZoom: $FM_UI_MAP_FIT_MAX_ZOOM,
    mapFlyDurationMs: $FM_UI_MAP_FLY_DURATION_MS,
    map3dPitchDeg: $FM_UI_MAP_3D_PITCH_DEG,
    mapExtrusionMinZoom: $FM_UI_MAP_EXTRUSION_MIN_ZOOM,
    floorPlanHeightPx: $FM_UI_FLOORPLAN_HEIGHT_PX,
    floorPlanMobileHeightPx: $FM_UI_FLOORPLAN_MOBILE_HEIGHT_PX,
    replayTrailLengthSec: $FM_UI_REPLAY_TRAIL_LENGTH_SEC,
    mapOverviewZoom: $FM_UI_MAP_OVERVIEW_ZOOM,
    mapPitchEaseDurationMs: $FM_UI_MAP_PITCH_EASE_DURATION_MS,
    topologyAnimationDurationMs: $FM_UI_TOPOLOGY_ANIMATION_DURATION_MS,
    topologyNodeRepulsion: $FM_UI_TOPOLOGY_NODE_REPULSION,
    topologyIdealEdgeLength: $FM_UI_TOPOLOGY_IDEAL_EDGE_LENGTH,
    topologyEdgeElasticity: $FM_UI_TOPOLOGY_EDGE_ELASTICITY,
    topologyGravity: $FM_UI_TOPOLOGY_GRAVITY,
    topologyTile: $FM_UI_TOPOLOGY_TILE,
    shortcuts: {
      "shortcuts.help": "$FM_UI_SHORTCUT_HELP",
      "inspector.close": "$FM_UI_SHORTCUT_CLOSE_INSPECTOR",
      "search.focus": "$FM_UI_SHORTCUT_SEARCH_FOCUS",
      "dashboard.undo": "$FM_UI_SHORTCUT_DASHBOARD_UNDO",
      "dashboard.redo": "$FM_UI_SHORTCUT_DASHBOARD_REDO",
      "logs.focus": "$FM_UI_SHORTCUT_LOGS_FOCUS",
      "logs.clear": "$FM_UI_SHORTCUT_LOGS_CLEAR",
      "logs.clear-search": "$FM_UI_SHORTCUT_LOGS_CLEAR_SEARCH"
    }
  }
JSEOF

if [ -n "$OIDC_AUTHORITY" ]; then
  # OIDC scope list comes from env — no default in code.
  : "${FM_OIDC_SCOPE:?FM_OIDC_SCOPE must be set (see deploy/env/.env.example)}"
  cat >> "$CONFIG_FILE" <<JSEOF
  ,
  oidc: {
    authority: "$OIDC_AUTHORITY",
    client_id: "$OIDC_CLIENT_ID",
    project_resource_id: "${OIDC_PROJECT_ID:-}",
    redirect_uri: "$OIDC_REDIRECT_URI",
    post_logout_redirect_uri: "${OIDC_POST_LOGOUT_REDIRECT_URI:-${OIDC_REDIRECT_URI%/callback}/}",
    response_type: "code",
    scope: "$FM_OIDC_SCOPE",
    filterProtocolClaims: true,
    loadUserInfo: true,
    automaticSilentRenew: true,
    metadata: {
      issuer: "${OIDC_ISSUER:-$OIDC_AUTHORITY}",
      authorization_endpoint: "${OIDC_AUTH_ENDPOINT:-$OIDC_AUTHORITY/oauth/v2/authorize}",
      token_endpoint: "${OIDC_TOKEN_ENDPOINT:-$OIDC_AUTHORITY/oauth/v2/token}",
      userinfo_endpoint: "${OIDC_USERINFO_ENDPOINT:-$OIDC_AUTHORITY/oidc/v1/userinfo}",
      end_session_endpoint: "${OIDC_END_SESSION_ENDPOINT:-$OIDC_AUTHORITY/oidc/v1/end_session}",
      jwks_uri: "${OIDC_JWKS_URI:-$OIDC_AUTHORITY/oauth/v2/keys}"
    }
  }
JSEOF
fi

cat >> "$CONFIG_FILE" <<JSEOF
};
JSEOF

if [ -n "$OIDC_AUTHORITY" ]; then
  echo "[entrypoint] Runtime config written to $CONFIG_FILE (with OIDC)"
else
  echo "[entrypoint] Runtime config written to $CONFIG_FILE (no OIDC)"
fi

# Inject runtime config inline into index.html.
# Safari with self-signed certs blocks external <script src="/runtime-config.js">,
# so we inline the JS directly into the HTML to avoid the separate request.
#
# inline_runtime_config <tmpl> <out> <runtime_config_url>
#   Reads <tmpl>, replaces the <script src="$runtime_config_url"> line with
#   an inline <script> containing $CONFIG_FILE contents, and writes to <out>.
inline_runtime_config() {
  tmpl="$1"
  out="$2"
  runtime_src="$3"
  marker="<script src=\"${runtime_src}\"></script>"
  if [ -f "$tmpl" ]; then
    {
      while IFS= read -r line; do
        case "$line" in
          *"$marker"*)
            printf '    <script>\n'
            cat "$CONFIG_FILE"
            printf '    </script>\n'
            ;;
          *)
            printf '%s\n' "$line"
            ;;
        esac
      done
    } < "$tmpl" > "$out"
    echo "[entrypoint] $out generated with inline runtime config"
  fi
}

# Customer-facing template bundle at /
INDEX_TMPL="/app/frontend/dist/index.html.tmpl"
INDEX_OUT="/tmp/index.html"
if [ -f "$INDEX_TMPL" ]; then
  inline_runtime_config "$INDEX_TMPL" "$INDEX_OUT" "/runtime-config.js"
else
  echo "[entrypoint] WARNING: index.html.tmpl not found, skipping inline injection"
fi

# Operator FM SPA bundle at /admin/ (only present in dual-bundle runtime-bm
# image). Vite emits the runtime-config.js reference with the configured
# base, so the marker here uses /admin/runtime-config.js.
ADMIN_INDEX_TMPL="/app/frontend/dist-admin/index.html.tmpl"
ADMIN_INDEX_OUT="/tmp/index-admin.html"
if [ -f "$ADMIN_INDEX_TMPL" ]; then
  inline_runtime_config "$ADMIN_INDEX_TMPL" "$ADMIN_INDEX_OUT" "/admin/runtime-config.js"
fi

exec "$@"
