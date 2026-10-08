# shellcheck shell=bash
# shellcheck disable=SC2153  # TOKEN, PROJECT_ID, ZITADEL_URL set in bootstrap-zitadel.sh
build_spa_oidc_configuration() {
    jq -cn \
        --arg redirectUri "${FM_BASE_URL}/callback" \
        --arg postLogoutRedirectUri "${FM_BASE_URL}/" \
        '{
            responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
            # The SPA asks for offline_access and runs automaticSilentRenew;
            # without the refresh grant Zitadel issues no refresh token, so the
            # renew has nothing to renew with and the access token simply
            # expires — the user is bounced to the login screen mid-session.
            grantTypes: [
                "OIDC_GRANT_TYPE_AUTHORIZATION_CODE",
                "OIDC_GRANT_TYPE_REFRESH_TOKEN"
            ],
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

# Search-before-create, then push the wanted config on every run so drift
# heals; Zitadel answers "No changes" when nothing differs.
# Sets OIDC_APP_ID and OIDC_APP_CLIENT_ID.
ensure_oidc_app() {
    local name="$1"
    local oidc_config="$2"
    local existing_app create_body create_response update_body update_response

    OIDC_APP_ID=""
    OIDC_APP_CLIENT_ID=""
    existing_app=$(search_app_by_name "$PROJECT_ID" "$name")

    if [ -n "$existing_app" ]; then
        OIDC_APP_ID=$(echo "$existing_app" | jq -r '.applicationId')
        OIDC_APP_CLIENT_ID=$(echo "$existing_app" | jq -r '.oidcConfiguration.clientId // empty')
        if [ -z "$OIDC_APP_CLIENT_ID" ]; then
            echo "ERROR: App $name ($OIDC_APP_ID) has no OIDC client id" >&2
            exit 1
        fi
        echo "  App exists: $OIDC_APP_ID (clientId: $OIDC_APP_CLIENT_ID)"
    else
        echo "  Creating app $name..."
        create_body=$(jq -cn \
            --arg projectId "$PROJECT_ID" \
            --arg name "$name" \
            --argjson oidc "$oidc_config" \
            '{projectId:$projectId,name:$name,oidcConfiguration:$oidc}')
        create_response=$(zitadel_api "POST" \
            "/zitadel.application.v2.ApplicationService/CreateApplication" \
            "$create_body" "$TOKEN" "$ZITADEL_URL")
        OIDC_APP_ID=$(echo "$create_response" | jq -r '.applicationId // empty')
        OIDC_APP_CLIENT_ID=$(echo "$create_response" | jq -r '.oidcConfiguration.clientId // empty')
        if [ -z "$OIDC_APP_ID" ] || [ -z "$OIDC_APP_CLIENT_ID" ]; then
            echo "ERROR: Creating app $name did not return expected fields" >&2
            echo "$create_response" >&2
            exit 1
        fi
        echo "  Created app: $OIDC_APP_ID (clientId: $OIDC_APP_CLIENT_ID)"
    fi

    echo "  Updating OIDC config of $name..."
    update_body=$(jq -cn \
        --arg projectId "$PROJECT_ID" \
        --arg applicationId "$OIDC_APP_ID" \
        --argjson oidc "$oidc_config" \
        '{projectId:$projectId,applicationId:$applicationId,oidcConfiguration:$oidc}')
    update_response=$(zitadel_api "POST" \
        "/zitadel.application.v2.ApplicationService/UpdateApplication" \
        "$update_body" "$TOKEN" "$ZITADEL_URL")
    if ! echo "$update_response" | jq -e '.changeDate' >/dev/null 2>&1 && \
       ! echo "$update_response" | is_zitadel_no_change; then
        echo "ERROR: Failed to update OIDC config of $name" >&2
        echo "$update_response" >&2
        exit 1
    fi
    echo "  OIDC config of $name is current"
}

ensure_spa_app() {
    echo ""
    echo "--- SPA App: $SPA_APP_NAME (PKCE, devMode=true) ---"
    echo "  Redirect URI: ${FM_BASE_URL}/callback"
    ensure_oidc_app "$SPA_APP_NAME" "$(build_spa_oidc_configuration)"
    FRONTEND_APP_ID="$OIDC_APP_ID"
    FRONTEND_CLIENT_ID="$OIDC_APP_CLIENT_ID"
    echo "  SPA app: $FRONTEND_APP_ID (clientId: $FRONTEND_CLIENT_ID)"
}

# stdout: the name prefix of the MCP apps of a Fleet project ("<project>-mcp").
# Bootstrap and the update-time sync both name the apps through this.
mcp_app_name_prefix() {
    printf '%s-mcp' "$1"
}

# Levels an MCP app may exist for. Browser login reaches read and write; full
# stays key-only, but a leftover full app is still removed.
MCP_OAUTH_APP_LEVELS="read write full"

# Redirects of the MCP clients Fleet supports. Zitadel matches a NATIVE app's
# loopback redirect on any port, so loopback entries carry none.
MCP_OAUTH_CLIENT_REDIRECT_URIS=(
    "https://claude.ai/api/mcp/auth_callback"
    "http://localhost/callback"
    "http://127.0.0.1/callback"
    "http://127.0.0.1"
    "https://vscode.dev/redirect"
    "https://www.cursor.com/agents/mcp/oauth/callback"
)

# stdout: the enabled levels from FM_MCP_OAUTH_LEVELS, one per line, in a
# fixed order. Unset or empty means read,write; "none" turns browser login off.
mcp_oauth_levels() {
    local raw="${FM_MCP_OAUTH_LEVELS:-read,write}"
    local level wanted=" "
    [ "$raw" = "none" ] && return 0
    local IFS=','
    for level in $raw; do
        level="${level//[[:space:]]/}"
        case "$level" in
            read|write) wanted="${wanted}${level} " ;;
            full)
                echo "ERROR: FM_MCP_OAUTH_LEVELS cannot enable full; full stays key-only" >&2
                return 1
                ;;
            *)
                echo "ERROR: FM_MCP_OAUTH_LEVELS has unknown level '${level}' (use read, write or none)" >&2
                return 1
                ;;
        esac
    done
    for level in read write; do
        case "$wanted" in *" ${level} "*) printf '%s\n' "$level" ;; esac
    done
}

# stdout: one redirect URI per line; the built-in list, then the operator's
# FM_MCP_OAUTH_EXTRA_REDIRECT_URIS (comma-separated), without duplicates.
mcp_oauth_redirect_uris() {
    local uri extra
    local -a extras=() uris=("${MCP_OAUTH_CLIENT_REDIRECT_URIS[@]}")
    IFS=',' read -r -a extras <<<"${FM_MCP_OAUTH_EXTRA_REDIRECT_URIS:-}"
    for extra in "${extras[@]:-}"; do
        uri="${extra//[[:space:]]/}"
        [ -z "$uri" ] && continue
        case "$uri" in
            https://?*|http://localhost|http://localhost[:/]*|http://127.0.0.1|http://127.0.0.1[:/]*) ;;
            http://*)
                echo "ERROR: FM_MCP_OAUTH_EXTRA_REDIRECT_URIS allows plain http only for loopback: $uri" >&2
                return 1
                ;;
            [a-z]*://?*) ;;
            *)
                echo "ERROR: FM_MCP_OAUTH_EXTRA_REDIRECT_URIS entry is not a URI: $uri" >&2
                return 1
                ;;
        esac
        uris+=("$uri")
    done
    printf '%s\n' "${uris[@]}" | awk '!seen[$0]++'
}

# A public PKCE client: no secret, code + refresh, opaque bearer tokens that
# Fleet introspects, and devMode off so Zitadel enforces the redirect list.
build_mcp_oidc_configuration() {
    local redirect_uris="$1"
    jq -cn --argjson redirectUris "$redirect_uris" '{
        responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
        grantTypes: [
            "OIDC_GRANT_TYPE_AUTHORIZATION_CODE",
            "OIDC_GRANT_TYPE_REFRESH_TOKEN"
        ],
        applicationType: "OIDC_APP_TYPE_NATIVE",
        authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
        redirectUris: $redirectUris,
        postLogoutRedirectUris: [],
        version: "OIDC_VERSION_1_0",
        developmentMode: false,
        accessTokenType: "OIDC_TOKEN_TYPE_BEARER",
        accessTokenRoleAssertion: true,
        idTokenRoleAssertion: true,
        idTokenUserinfoAssertion: true
    }'
}

# One NATIVE app per enabled MCP level; apps of disabled levels are deleted so
# no unmapped app can mint project tokens. Sets FM_MCP_OAUTH_CLIENT_IDS.
ensure_mcp_apps() {
    local levels redirect_lines redirect_uris oidc_config level name existing_app app_id

    echo ""
    echo "--- MCP Apps: ${MCP_APP_NAME_PREFIX}-<level> ---"
    levels=$(mcp_oauth_levels) || exit 1
    redirect_lines=$(mcp_oauth_redirect_uris) || exit 1
    redirect_uris=$(printf '%s\n' "$redirect_lines" | jq -R . | jq -sc .)
    oidc_config=$(build_mcp_oidc_configuration "$redirect_uris")
    FM_MCP_OAUTH_CLIENT_IDS=""

    for level in $MCP_OAUTH_APP_LEVELS; do
        name="${MCP_APP_NAME_PREFIX}-${level}"
        if printf '%s\n' "$levels" | grep -qx "$level"; then
            ensure_oidc_app "$name" "$oidc_config"
            FM_MCP_OAUTH_CLIENT_IDS="${FM_MCP_OAUTH_CLIENT_IDS:+${FM_MCP_OAUTH_CLIENT_IDS},}${level}=${OIDC_APP_CLIENT_ID}"
            continue
        fi
        existing_app=$(search_app_by_name "$PROJECT_ID" "$name")
        [ -n "$existing_app" ] || continue
        app_id=$(echo "$existing_app" | jq -r '.applicationId')
        if ! delete_app "$PROJECT_ID" "$app_id"; then
            echo "ERROR: Could not delete disabled MCP app $name ($app_id)" >&2
            exit 1
        fi
        echo "  Deleted disabled MCP app: $name"
    done
    echo "  MCP browser login: ${FM_MCP_OAUTH_CLIENT_IDS:-off}"
}
