# shellcheck shell=bash
# shellcheck disable=SC2153  # TOKEN, PROJECT_ID, ZITADEL_URL set in bootstrap-zitadel.sh
build_spa_oidc_configuration() {
    jq -cn \
        --arg redirectUri "${FM_BASE_URL}/callback" \
        --arg postLogoutRedirectUri "${FM_BASE_URL}/" \
        '{
            responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
            grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
            applicationType: "OIDC_APP_TYPE_USER_AGENT",
            authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
            redirectUris: [$redirectUri],
            postLogoutRedirectUris: [$postLogoutRedirectUri],
            version: "OIDC_VERSION_1_0",
            developmentMode: true,
            accessTokenType: "OIDC_TOKEN_TYPE_BEARER",
            accessTokenRoleAssertion: true,
            idTokenRoleAssertion: true,
            idTokenUserinfoAssertion: true
        }'
}
search_app_by_name() {
    local project_id="$1"
    local name="$2"
    local body response
    body=$(jq -cn --arg projectId "$project_id" --arg name "$name" \
        '{pagination:{limit:1},filters:[{projectIdFilter:{projectId:$projectId}},{nameFilter:{name:$name,method:"TEXT_FILTER_METHOD_EQUALS"}}]}')
    response=$(zitadel_api "POST" "/zitadel.application.v2.ApplicationService/ListApplications" \
        "$body" "$TOKEN" "$ZITADEL_URL")
    echo "$response" | jq -r '(.applications // [])[0] // empty'
}

regenerate_app_client_secret() {
    local project_id="$1"
    local app_id="$2"
    local body response
    body=$(jq -cn --arg projectId "$project_id" --arg applicationId "$app_id" \
        '{projectId:$projectId,applicationId:$applicationId}')
    response=$(zitadel_api "POST" "/zitadel.application.v2.ApplicationService/GenerateClientSecret" \
        "$body" "$TOKEN" "$ZITADEL_URL")
    echo "$response" | jq -r '.clientSecret // empty'
}

delete_app() {
    local project_id="$1"
    local app_id="$2"
    local body response
    body=$(jq -cn --arg projectId "$project_id" --arg applicationId "$app_id" \
        '{projectId:$projectId,applicationId:$applicationId}')
    response=$(zitadel_api "POST" "/zitadel.application.v2.ApplicationService/DeleteApplication" \
        "$body" "$TOKEN" "$ZITADEL_URL")
    echo "$response" | jq -e '.deletionDate' >/dev/null 2>&1
}

ensure_backend_api_app() {
    local existing_api_app existing_auth_method want_auth_method get_app_body
    local get_app_response update_body update_response new_secret needs_regen
    local zitadel_auth_method api_body api_response verify_status

    echo ""
    echo "--- API App: $API_APP_NAME ---"

    existing_api_app=$(search_app_by_name "$PROJECT_ID" "$API_APP_NAME")

    BACKEND_CLIENT_ID=""
    BACKEND_CLIENT_SECRET=""

    if [ -n "$existing_api_app" ]; then
        BACKEND_APP_ID=$(echo "$existing_api_app" | jq -r '.applicationId')
        BACKEND_CLIENT_ID=$(echo "$existing_api_app" | jq -r '.apiConfiguration.clientId // empty')
        existing_auth_method=$(echo "$existing_api_app" | jq -r '.apiConfiguration.authMethodType // empty')
        echo "  API app exists: $BACKEND_APP_ID (clientId: $BACKEND_CLIENT_ID, auth: $existing_auth_method)"

        if [ -f "$STATE_FILE" ]; then
            BACKEND_CLIENT_SECRET=$(grep -oP '^ZITADEL_CLIENT_BACKEND_CLIENT_SECRET=\K.*' "$STATE_FILE" 2>/dev/null || true)
        fi

        case "$FM_OIDC_AUTH_METHOD" in
            jwt-profile) want_auth_method="API_AUTH_METHOD_TYPE_PRIVATE_KEY_JWT" ;;
            *)           want_auth_method="API_AUTH_METHOD_TYPE_BASIC" ;;
        esac
        get_app_body=$(jq -cn \
            --arg projectId "$PROJECT_ID" \
            --arg applicationId "$BACKEND_APP_ID" \
            '{projectId:$projectId,applicationId:$applicationId}')
        get_app_response=$(zitadel_api "POST" \
            "/zitadel.application.v2.ApplicationService/GetApplication" \
            "$get_app_body" "$TOKEN" "$ZITADEL_URL" 2>/dev/null || echo '{}')
        existing_auth_method=$(echo "$get_app_response" | \
            jq -r '.application.apiConfig.authMethodType // .apiConfig.authMethodType // empty')
        if [ -n "$existing_auth_method" ] && \
           [ "$existing_auth_method" != "$want_auth_method" ]; then
            echo "  Auth method drift: have=$existing_auth_method want=$want_auth_method — switching..."
            update_body=$(jq -cn \
                --arg projectId "$PROJECT_ID" \
                --arg applicationId "$BACKEND_APP_ID" \
                --arg authMethodType "$want_auth_method" \
                '{projectId:$projectId,applicationId:$applicationId,apiConfiguration:{authMethodType:$authMethodType}}')
            update_response=$(zitadel_api "POST" \
                "/zitadel.application.v2.ApplicationService/UpdateApplication" \
                "$update_body" "$TOKEN" "$ZITADEL_URL")
            if ! echo "$update_response" | jq -e '.changeDate' >/dev/null 2>&1 && \
               ! echo "$update_response" | is_zitadel_no_change; then
                echo "ERROR: Failed to switch API app authMethodType" >&2
                echo "$update_response" >&2
                exit 1
            fi
            new_secret=$(echo "$update_response" | jq -r '.apiConfiguration.clientSecret // empty')
            if [ -n "$new_secret" ]; then
                BACKEND_CLIENT_SECRET="$new_secret"
            else
                BACKEND_CLIENT_SECRET=""
            fi
            if [ "$want_auth_method" = "API_AUTH_METHOD_TYPE_PRIVATE_KEY_JWT" ] && \
               [ -f "$OIDC_INTROSPECTION_KEY_FILE" ]; then
                rm -f "$OIDC_INTROSPECTION_KEY_FILE"
                echo "  Cleared stale keyfile — a new one will be generated."
            fi
            echo "  Auth method switched to $want_auth_method"
        fi

        if [ "$FM_OIDC_AUTH_METHOD" = "basic" ]; then
            needs_regen=false
            if [ -z "$BACKEND_CLIENT_SECRET" ]; then
                echo "  No saved secret found — will regenerate."
                needs_regen=true
            else
                echo "  Verifying saved client secret..."
                verify_status=$(curl -so /dev/null -w '%{http_code}' \
                    -X POST "${ZITADEL_URL}/oauth/v2/introspect" \
                    -u "${BACKEND_CLIENT_ID}:${BACKEND_CLIENT_SECRET}" \
                    -d "token=verify-probe" 2>/dev/null || echo "000")
                if [ "$verify_status" = "200" ]; then
                    echo "  Client secret verified OK"
                else
                    echo "  Client secret is stale (introspect HTTP $verify_status) — regenerating."
                    needs_regen=true
                fi
            fi

            if [ "$needs_regen" = true ]; then
                BACKEND_CLIENT_SECRET=$(regenerate_app_client_secret "$PROJECT_ID" "$BACKEND_APP_ID" || true)
                if [ -z "$BACKEND_CLIENT_SECRET" ]; then
                    echo "  Regeneration failed — deleting and recreating API app..." >&2
                    if ! delete_app "$PROJECT_ID" "$BACKEND_APP_ID"; then
                        echo "ERROR: Could not delete stale API app $BACKEND_APP_ID" >&2
                        exit 1
                    fi
                    existing_api_app=""
                else
                    echo "  Secret regenerated"
                fi
            fi
        fi
    fi

    if [ -z "$existing_api_app" ]; then
        case "$FM_OIDC_AUTH_METHOD" in
            jwt-profile) zitadel_auth_method="API_AUTH_METHOD_TYPE_PRIVATE_KEY_JWT" ;;
            *)           zitadel_auth_method="API_AUTH_METHOD_TYPE_BASIC" ;;
        esac
        echo "  Creating API app (auth method: ${FM_OIDC_AUTH_METHOD})..."
        api_body=$(jq -cn \
            --arg projectId "$PROJECT_ID" \
            --arg name "$API_APP_NAME" \
            --arg authMethodType "$zitadel_auth_method" \
            '{projectId:$projectId,name:$name,apiConfiguration:{authMethodType:$authMethodType}}')
        api_response=$(zitadel_api "POST" \
            "/zitadel.application.v2.ApplicationService/CreateApplication" \
            "$api_body" "$TOKEN" "$ZITADEL_URL")
        BACKEND_APP_ID=$(echo "$api_response" | jq -r '.applicationId // empty')
        BACKEND_CLIENT_ID=$(echo "$api_response" | jq -r '.apiConfiguration.clientId // empty')
        BACKEND_CLIENT_SECRET=$(echo "$api_response" | jq -r '.apiConfiguration.clientSecret // empty')
        if [ -z "$BACKEND_APP_ID" ] || [ -z "$BACKEND_CLIENT_ID" ]; then
            echo "ERROR: API app creation did not return applicationId / clientId" >&2
            echo "$api_response" >&2
            exit 1
        fi
        if [ "$FM_OIDC_AUTH_METHOD" = "basic" ] && [ -z "$BACKEND_CLIENT_SECRET" ]; then
            echo "ERROR: BASIC auth app creation did not return clientSecret" >&2
            echo "$api_response" >&2
            exit 1
        fi
        echo "  Created API app: $BACKEND_APP_ID (clientId: $BACKEND_CLIENT_ID)"
    fi
}

ensure_oidc_introspection_key() {
    local existing_client oidc_key_dir key_response key_details

    [ "$FM_OIDC_AUTH_METHOD" = "jwt-profile" ] || return 0

    if [ -f "$OIDC_INTROSPECTION_KEY_FILE" ]; then
        existing_client=$(jq -r '.clientId // empty' \
            "$OIDC_INTROSPECTION_KEY_FILE" 2>/dev/null || true)
        if [ -n "$existing_client" ] && \
           [ "$existing_client" != "$BACKEND_CLIENT_ID" ]; then
            echo "  OIDC key file points at deleted client ${existing_client} (current: ${BACKEND_CLIENT_ID}); regenerating."
            rm -f "$OIDC_INTROSPECTION_KEY_FILE"
        fi
    fi
    if [ -f "$OIDC_INTROSPECTION_KEY_FILE" ]; then
        echo "  OIDC introspection key file exists: $OIDC_INTROSPECTION_KEY_FILE"
    else
        echo "  Generating OIDC introspection app key..."
        oidc_key_dir="$(dirname "$OIDC_INTROSPECTION_KEY_FILE")"
        mkdir -p "$oidc_key_dir"
        chmod 0700 "$oidc_key_dir"
        export ZITADEL_ORG_HEADER="$ORGANIZATION_ID"
        key_response=$(zitadel_api "POST" \
            "/management/v1/projects/${PROJECT_ID}/apps/${BACKEND_APP_ID}/keys" \
            '{"type":"KEY_TYPE_JSON"}' "$TOKEN" "$ZITADEL_URL")
        unset ZITADEL_ORG_HEADER
        key_details=$(echo "$key_response" | jq -r '.keyDetails // empty')
        if [ -z "$key_details" ]; then
            echo "ERROR: app key generation did not return keyDetails" >&2
            echo "$key_response" >&2
            exit 1
        fi
        echo "$key_details" | base64 -d > "${OIDC_INTROSPECTION_KEY_FILE}.tmp"
        chmod 0600 "${OIDC_INTROSPECTION_KEY_FILE}.tmp"
        mv "${OIDC_INTROSPECTION_KEY_FILE}.tmp" "$OIDC_INTROSPECTION_KEY_FILE"
        echo "  Saved key file: $OIDC_INTROSPECTION_KEY_FILE"
    fi
}

ensure_spa_app() {
    local existing_spa_app spa_oidc_config create_body spa_response update_body update_response

    echo ""
    echo "--- SPA App: $SPA_APP_NAME ---"

    existing_spa_app=$(search_app_by_name "$PROJECT_ID" "$SPA_APP_NAME")
    spa_oidc_config=$(build_spa_oidc_configuration)
    FRONTEND_CLIENT_ID=""

    if [ -n "$existing_spa_app" ]; then
        FRONTEND_APP_ID=$(echo "$existing_spa_app" | jq -r '.applicationId')
        FRONTEND_CLIENT_ID=$(echo "$existing_spa_app" | jq -r '.oidcConfiguration.clientId // empty')
        echo "  SPA app exists: $FRONTEND_APP_ID (clientId: $FRONTEND_CLIENT_ID)"
    else
        echo "  Creating SPA app (PKCE, devMode=true)..."
        echo "  Redirect URI: ${FM_BASE_URL}/callback"
        create_body=$(jq -cn \
            --arg projectId "$PROJECT_ID" \
            --arg name "$SPA_APP_NAME" \
            --argjson oidc "$spa_oidc_config" \
            '{projectId:$projectId,name:$name,oidcConfiguration:$oidc}')
        spa_response=$(zitadel_api "POST" \
            "/zitadel.application.v2.ApplicationService/CreateApplication" \
            "$create_body" "$TOKEN" "$ZITADEL_URL")
        FRONTEND_APP_ID=$(echo "$spa_response" | jq -r '.applicationId // empty')
        FRONTEND_CLIENT_ID=$(echo "$spa_response" | jq -r '.oidcConfiguration.clientId // empty')
        if [ -z "$FRONTEND_APP_ID" ] || [ -z "$FRONTEND_CLIENT_ID" ]; then
            echo "ERROR: SPA app creation did not return expected fields" >&2
            echo "$spa_response" >&2
            exit 1
        fi
        echo "  Created SPA app: $FRONTEND_APP_ID (clientId: $FRONTEND_CLIENT_ID)"
    fi

    echo "  Updating SPA OIDC config (devMode=true, redirect URIs)..."
    update_body=$(jq -cn \
        --arg projectId "$PROJECT_ID" \
        --arg applicationId "$FRONTEND_APP_ID" \
        --argjson oidc "$spa_oidc_config" \
        '{projectId:$projectId,applicationId:$applicationId,oidcConfiguration:$oidc}')
    update_response=$(zitadel_api "POST" \
        "/zitadel.application.v2.ApplicationService/UpdateApplication" \
        "$update_body" "$TOKEN" "$ZITADEL_URL")
    if ! echo "$update_response" | jq -e '.changeDate' >/dev/null 2>&1 && \
       ! echo "$update_response" | is_zitadel_no_change; then
        echo "ERROR: Failed to update SPA OIDC config" >&2
        echo "$update_response" >&2
        exit 1
    fi
    echo "  SPA config updated"
}
