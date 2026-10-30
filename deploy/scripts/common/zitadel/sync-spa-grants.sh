#!/usr/bin/env bash
# Reconcile the refresh-token grant on the existing Fleet SPA without running
# the full Zitadel bootstrap. This script never creates an application: it
# verifies the exact app/client recorded in state, then changes grantTypes only.
#
# Env: ZITADEL_URL, MACHINEKEY_PATH, STATE_FILE (required), ZITADEL_HOST_HEADER
#      (optional, for local API calls routed by the public issuer host).

set -euo pipefail

ZITADEL_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=deploy/scripts/common/zitadel-lib.sh
source "$ZITADEL_SCRIPTS_DIR/../zitadel-lib.sh"
# shellcheck source=deploy/scripts/common/zitadel/policies.sh
source "$ZITADEL_SCRIPTS_DIR/policies.sh"
# shellcheck source=deploy/scripts/common/zitadel/users.sh
source "$ZITADEL_SCRIPTS_DIR/users.sh"
# shellcheck source=deploy/scripts/common/zitadel/apps.sh
source "$ZITADEL_SCRIPTS_DIR/apps.sh"

validate_spa_grant_state() {
    if ! awk -F= '
        BEGIN {
            required["ZITADEL_CLIENT_PROJECT_ID"] = 1
            required["ZITADEL_CLIENT_FRONTEND_APP_ID"] = 1
            required["ZITADEL_CLIENT_FRONTEND_CLIENT_ID"] = 1
        }
        $1 in required {
            count[$1]++
            value = substr($0, index($0, "=") + 1)
            if (value !~ /[^[:space:]]/) invalid = 1
        }
        END {
            for (key in required) {
                if (count[key] != 1) invalid = 1
            }
            exit invalid
        }
    ' "$STATE_FILE"; then
        echo "ERROR: Zitadel state is missing a unique Fleet SPA project/app/client identity; refusing to modify applications" >&2
        return 1
    fi
}

get_application_by_id() {
    local application_id="$1" body response
    body="$(jq -cn --arg applicationId "$application_id" '{applicationId:$applicationId}')"
    if ! response="$(zitadel_api "POST" \
        "/zitadel.application.v2.ApplicationService/GetApplication" \
        "$body" "$TOKEN" "$ZITADEL_URL")"; then
        return 1
    fi
    jq -ce '.application' <<<"$response" 2>/dev/null
}

validate_spa_identity() {
    local app_json="$1"
    local expected_project_id="$2"
    local expected_app_id="$3"
    local expected_client_id="$4"
    local actual_project_id actual_app_id actual_client_id

    actual_project_id="$(jq -r '.projectId // empty' <<<"$app_json")"
    actual_app_id="$(jq -r '.applicationId // empty' <<<"$app_json")"
    actual_client_id="$(jq -r '.oidcConfiguration.clientId // empty' <<<"$app_json")"

    if [ "$actual_project_id" != "$expected_project_id" ]; then
        echo "ERROR: Saved Fleet SPA app does not belong to the saved project; refusing to change application grants" >&2
        return 1
    fi
    if [ "$actual_app_id" != "$expected_app_id" ]; then
        echo "ERROR: Zitadel returned a different Fleet SPA application id than requested; refusing to update the wrong app" >&2
        return 1
    fi
    if [ "$actual_client_id" != "$expected_client_id" ]; then
        echo "ERROR: Fleet SPA client id does not match saved state; refusing to change application grants" >&2
        return 1
    fi
}

sync_spa_refresh_grant() {
    ZITADEL_URL="${ZITADEL_URL:?ZITADEL_URL is required}"
    MACHINEKEY_PATH="${MACHINEKEY_PATH:?MACHINEKEY_PATH is required}"
    STATE_FILE="${STATE_FILE:?STATE_FILE is required}"
    [ -f "$STATE_FILE" ] || {
        echo "ERROR: State file not found: $STATE_FILE" >&2
        return 1
    }
    validate_spa_grant_state || return 1

    PROJECT_ID="$(state_var ZITADEL_CLIENT_PROJECT_ID)"
    local expected_app_id expected_client_id existing_app
    local grant_types updated_grant_types update_body update_response verified_app
    expected_app_id="$(state_var ZITADEL_CLIENT_FRONTEND_APP_ID)"
    expected_client_id="$(state_var ZITADEL_CLIENT_FRONTEND_CLIENT_ID)"

    if ! TOKEN="$(zitadel_get_token "$MACHINEKEY_PATH" "$ZITADEL_URL" 2>/dev/null)"; then
        echo "ERROR: Could not authenticate with the first-instance machinekey" >&2
        return 1
    fi

    if ! existing_app="$(get_application_by_id "$expected_app_id")"; then
        echo "ERROR: Could not read existing Fleet SPA $expected_app_id from Zitadel; refusing to create or replace applications" >&2
        return 1
    fi
    validate_spa_identity "$existing_app" "$PROJECT_ID" "$expected_app_id" "$expected_client_id" || return 1

    grant_types="$(jq -c '.oidcConfiguration.grantTypes // []' <<<"$existing_app")"
    if ! jq -e 'index("OIDC_GRANT_TYPE_AUTHORIZATION_CODE") != null' >/dev/null <<<"$grant_types"; then
        echo "ERROR: Existing Fleet SPA lacks the authorization-code grant; refusing a narrow refresh-token repair" >&2
        return 1
    fi
    if jq -e 'index("OIDC_GRANT_TYPE_REFRESH_TOKEN") != null' >/dev/null <<<"$grant_types"; then
        echo "  Fleet SPA refresh-token grant is already current"
        return 0
    fi

    updated_grant_types="$(jq -cn --argjson grants "$grant_types" '
        reduce ($grants + ["OIDC_GRANT_TYPE_REFRESH_TOKEN"])[] as $grant
            ([]; if index($grant) then . else . + [$grant] end)
    ')"
    # Zitadel's v4 UpdateOIDCApplicationConfigurationRequest is patch-like:
    # omitted fields are unchanged. Send grantTypes only so this repair cannot
    # rewrite redirect URIs, auth method, token format, login UI or assertions.
    update_body="$(jq -cn \
        --arg projectId "$PROJECT_ID" \
        --arg applicationId "$expected_app_id" \
        --argjson grantTypes "$updated_grant_types" \
        '{projectId:$projectId,applicationId:$applicationId,oidcConfiguration:{grantTypes:$grantTypes}}')"

    if ! update_response="$(zitadel_api "POST" \
        "/zitadel.application.v2.ApplicationService/UpdateApplication" \
        "$update_body" "$TOKEN" "$ZITADEL_URL")"; then
        echo "ERROR: Zitadel request failed while reconciling the Fleet SPA refresh-token grant" >&2
        return 1
    fi
    if ! jq -e '.changeDate' >/dev/null 2>&1 <<<"$update_response" && \
       ! is_zitadel_no_change <<<"$update_response"; then
        echo "ERROR: Zitadel rejected Fleet SPA refresh-token grant reconciliation" >&2
        return 1
    fi

    if ! verified_app="$(get_application_by_id "$expected_app_id")"; then
        echo "ERROR: Could not re-read Fleet SPA after refresh-token grant reconciliation" >&2
        return 1
    fi
    validate_spa_identity "$verified_app" "$PROJECT_ID" "$expected_app_id" "$expected_client_id" || return 1
    if ! jq -e '.oidcConfiguration.grantTypes // [] | index("OIDC_GRANT_TYPE_REFRESH_TOKEN") != null' \
        >/dev/null <<<"$verified_app"; then
        echo "ERROR: Fleet SPA update returned success but refresh-token grant is still missing" >&2
        return 1
    fi

    echo "  Fleet SPA refresh-token grant reconciled"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    sync_spa_refresh_grant
fi
