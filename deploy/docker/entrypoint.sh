#!/bin/sh
set -e

# Seed default assets (backgrounds, profile pics) into the uploads volume.
# Copies only files that don't already exist — user uploads are never overwritten.
SEED_DIR="/app/backend/uploads-seed"
UPLOADS_DIR="/app/backend/uploads"
if [ -d "$SEED_DIR" ]; then
  SEED_COUNT=0
  for src in $(find "$SEED_DIR" -type f); do
    rel="${src#$SEED_DIR/}"
    dst="$UPLOADS_DIR/$rel"
    if [ ! -f "$dst" ]; then
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst"
      SEED_COUNT=$((SEED_COUNT + 1))
    fi
  done
  echo "[entrypoint] Seed assets: $SEED_COUNT new files copied to uploads volume"
fi

# Generate frontend runtime config from environment variables.
# Written to /tmp (writable tmpfs) — symlinked from /app/frontend/dist/runtime-config.js
CONFIG_FILE="/tmp/runtime-config.js"

# Debug/perf settings (default: off in production, overridable per environment)
FM_DEBUG_DEFAULT="${FM_DEBUG_DEFAULT:-false}"
FM_PERF_TRACING="${FM_PERF_TRACING:-false}"
FM_OBSERVABILITY="${FM_OBSERVABILITY:-false}"

if [ -n "$OIDC_AUTHORITY" ]; then
  cat > "$CONFIG_FILE" <<JSEOF
window.__FM_RUNTIME_CONFIG__ = {
  debugDefault: $FM_DEBUG_DEFAULT,
  perfTracing: $FM_PERF_TRACING,
  observability: $FM_OBSERVABILITY,
  oidc: {
    authority: "$OIDC_AUTHORITY",
    client_id: "$OIDC_CLIENT_ID",
    project_resource_id: "${OIDC_PROJECT_ID:-}",
    redirect_uri: "$OIDC_REDIRECT_URI",
    response_type: "code",
    scope: "openid profile email offline_access",
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
};
JSEOF
  echo "[entrypoint] Runtime config written to $CONFIG_FILE (with OIDC)"
else
  cat > "$CONFIG_FILE" <<JSEOF
window.__FM_RUNTIME_CONFIG__ = {
  debugDefault: $FM_DEBUG_DEFAULT,
  perfTracing: $FM_PERF_TRACING,
  observability: $FM_OBSERVABILITY
};
JSEOF
  echo "[entrypoint] Runtime config written to $CONFIG_FILE (no OIDC)"
fi

# Inject runtime config inline into index.html.
# Safari with self-signed certs blocks external <script src="/runtime-config.js">,
# so we inline the JS directly into the HTML to avoid the separate request.
INDEX_TMPL="/app/frontend/dist/index.html.tmpl"
INDEX_OUT="/tmp/index.html"
if [ -f "$INDEX_TMPL" ]; then
  {
    while IFS= read -r line; do
      case "$line" in
        *'<script src="/runtime-config.js"></script>'*)
          printf '    <script>\n'
          cat "$CONFIG_FILE"
          printf '    </script>\n'
          ;;
        *)
          printf '%s\n' "$line"
          ;;
      esac
    done
  } < "$INDEX_TMPL" > "$INDEX_OUT"
  echo "[entrypoint] index.html generated with inline runtime config"
else
  echo "[entrypoint] WARNING: index.html.tmpl not found, skipping inline injection"
fi

exec "$@"
