#!/usr/bin/env bash
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/common/zitadel/sync-spa-grants.sh
source "$TEST_DIR/sync-spa-grants.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

STATE_FILE="$tmp_dir/zitadel.env"
MACHINEKEY_PATH="$tmp_dir/machinekey.json"
ZITADEL_URL="http://zitadel.test"
CAPTURE_FILE="$tmp_dir/update.json"
GET_COUNT_FILE="$tmp_dir/get-count"
APP_MODE="old-then-current"

cat >"$STATE_FILE" <<'EOF'
ZITADEL_CLIENT_PROJECT_ID=project-1
ZITADEL_PROJECT_NAME=fleet-manager
ZITADEL_CLIENT_FRONTEND_APP_ID=app-1
ZITADEL_CLIENT_FRONTEND_CLIENT_ID=client-1
EOF
printf '{}\n' >"$MACHINEKEY_PATH"

zitadel_get_token() {
    printf 'test-token'
}

old_app_json() {
    jq -cn '{
        projectId:"project-1",
        name:"operator-renamed-spa",
        applicationId:"app-1",
        oidcConfiguration:{
            clientId:"client-1",
            grantTypes:["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"]
        }
    }'
}

current_app_json() {
    jq -cn '{
        projectId:"project-1",
        name:"operator-renamed-spa",
        applicationId:"app-1",
        oidcConfiguration:{
            clientId:"client-1",
            grantTypes:[
                "OIDC_GRANT_TYPE_AUTHORIZATION_CODE",
                "OIDC_GRANT_TYPE_REFRESH_TOKEN"
            ]
        }
    }'
}

zitadel_api() {
    local _method="$1" path="$2" body="$3" count=0 app
    case "$path" in
        */GetApplication)
            [ -f "$GET_COUNT_FILE" ] && read -r count <"$GET_COUNT_FILE"
            count=$((count + 1))
            printf '%s\n' "$count" >"$GET_COUNT_FILE"
            case "$APP_MODE" in
                old-then-current)
                    if [ "$count" -eq 1 ]; then app="$(old_app_json)"; else app="$(current_app_json)"; fi
                    ;;
                current) app="$(current_app_json)" ;;
                mismatch)
                    app="$(jq -cn '{
                        projectId:"project-1",
                        name:"fleet-manager-spa",
                        applicationId:"different-app",
                        oidcConfiguration:{
                            clientId:"client-1",
                            grantTypes:["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"]
                        }
                    }')"
                    ;;
                wrong-grant)
                    app="$(jq -cn '{
                        projectId:"project-1",
                        name:"fleet-manager-spa",
                        applicationId:"app-1",
                        oidcConfiguration:{
                            clientId:"client-1",
                            grantTypes:["OIDC_GRANT_TYPE_IMPLICIT"]
                        }
                    }')"
                    ;;
                api-error)
                    printf '{"code":"permission_denied","message":"denied"}'
                    return 0
                    ;;
            esac
            jq -cn --argjson application "$app" '{application:$application}'
            ;;
        */UpdateApplication)
            printf '%s\n' "$body" >"$CAPTURE_FILE"
            printf '{"changeDate":"2026-10-30T00:00:00Z"}'
            ;;
        *)
            echo "unexpected Zitadel API path: $path" >&2
            return 98
            ;;
    esac
}

sync_spa_refresh_grant >/dev/null

jq -e '.projectId == "project-1" and .applicationId == "app-1"' \
    "$CAPTURE_FILE" >/dev/null
jq -e '.oidcConfiguration.grantTypes == [
    "OIDC_GRANT_TYPE_AUTHORIZATION_CODE",
    "OIDC_GRANT_TYPE_REFRESH_TOKEN"
]' "$CAPTURE_FILE" >/dev/null
jq -e '(.oidcConfiguration | keys) == ["grantTypes"]' "$CAPTURE_FILE" >/dev/null

# Already-correct state is a true no-op: no UpdateApplication request is made.
rm -f "$CAPTURE_FILE" "$GET_COUNT_FILE"
APP_MODE="current"
sync_spa_refresh_grant >/dev/null
[ ! -e "$CAPTURE_FILE" ]

# Identity mismatch must fail closed before any mutation.
rm -f "$GET_COUNT_FILE"
APP_MODE="mismatch"
if sync_spa_refresh_grant >/dev/null 2>"$tmp_dir/mismatch.err"; then
    echo "expected identity mismatch to fail" >&2
    exit 1
fi
grep -q 'different Fleet SPA application id' "$tmp_dir/mismatch.err"

# A surprising non-PKCE app with the same identity is not broadened silently.
rm -f "$GET_COUNT_FILE"
APP_MODE="wrong-grant"
if sync_spa_refresh_grant >/dev/null 2>"$tmp_dir/grant.err"; then
    echo "expected missing authorization-code grant to fail" >&2
    exit 1
fi
grep -q 'lacks the authorization-code grant' "$tmp_dir/grant.err"

# API-level read failures are reported as reconciliation failures without
# dumping the provider response.
rm -f "$GET_COUNT_FILE"
APP_MODE="api-error"
if sync_spa_refresh_grant >/dev/null 2>"$tmp_dir/api.err"; then
    echo "expected Zitadel read failure to fail" >&2
    exit 1
fi
grep -q 'Could not read existing Fleet SPA' "$tmp_dir/api.err"
if grep -q 'permission_denied\|denied' "$tmp_dir/api.err"; then
    echo "provider response leaked into reconciliation error" >&2
    exit 1
fi

echo "sync-spa-grants tests passed"
