# shellcheck shell=bash
# shellcheck disable=SC2153  # TOKEN, ORGANIZATION_ID, PROJECT_ID, etc. set in bootstrap-zitadel.sh
create_service_pat() {
    local user_id="$1"
    local response token
    response=$(zitadel_api "POST" "/v2/users/${user_id}/pats" \
        "$PAT_BODY" "$TOKEN" "$ZITADEL_URL")
    token=$(echo "$response" | jq -r '.token // empty')
    if [ -z "$token" ]; then
        echo "ERROR: Could not generate PAT for user $user_id" >&2
        echo "$response" | jq 'del(.token)' >&2
        return 1
    fi
    echo "$token"
}

write_login_client_pat_file() {
    local pat="$1"
    local volume="${COMPOSE_PROJECT_NAME:-fm}_zitadel-bootstrap"

    [ -n "$pat" ] || return 0
    docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume" >/dev/null
    docker run --rm -i \
        -v "${volume}:/zitadel/bootstrap" \
        busybox sh -c 'umask 077; cat > /zitadel/bootstrap/login-client.pat' \
        <<<"$pat"
}

state_var() {
    local key="$1"
    if [ -f "$STATE_FILE" ]; then
        grep -oP "^${key}=\\K.*" "$STATE_FILE" 2>/dev/null || true
    fi
}

csv_to_json_array() {
    printf '%s' "$1" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | jq -R . | jq -s 'map(select(length > 0))'
}

bootstrap_password_change_required() {
    case "${DEPLOY_ENV_NAME:-${DEPLOY_ENV:-}}" in
        public|prod|staging) printf 'true' ;;
        *) printf 'false' ;;
    esac
}

list_internal_org_roles() {
    local user_id="$1"
    local organization_id="$2"
    local request_body response

    request_body=$(jq -cn \
        --arg organizationId "$organization_id" \
        '{pagination:{limit:500},filters:[{resource:{organizationId:$organizationId}}]}')

    response=$(zitadel_api "POST" \
        "/zitadel.internal_permission.v2.InternalPermissionService/ListAdministrators" \
        "$request_body" "$TOKEN" "$ZITADEL_URL")
    echo "$response" | jq -c \
        --arg userId "$user_id" \
        '[.administrators[]? | select(.user.id == $userId) | .roles[]?] | unique'
}

merge_internal_org_role() {
    local current_roles="$1"
    local role="$2"

    echo "$current_roles" | jq -c --arg role "$role" '. + [$role] | unique'
}

update_internal_org_roles() {
    local user_id="$1"
    local organization_id="$2"
    local roles_json="$3"

    local update_body
    update_body=$(jq -cn \
        --arg userId "$user_id" \
        --arg organizationId "$organization_id" \
        --argjson roles "$roles_json" \
        '{userId:$userId,resource:{organizationId:$organizationId},roles:$roles}')
    zitadel_api "POST" \
        "/zitadel.internal_permission.v2.InternalPermissionService/UpdateAdministrator" \
        "$update_body" "$TOKEN" "$ZITADEL_URL"
}

create_internal_org_role() {
    local user_id="$1"
    local organization_id="$2"
    local role="$3"

    local org_admin_body
    org_admin_body=$(jq -cn \
        --arg userId "$user_id" \
        --arg organizationId "$organization_id" \
        --arg role "$role" \
        '{userId:$userId,resource:{organizationId:$organizationId},roles:[$role]}')
    zitadel_api "POST" \
        "/zitadel.internal_permission.v2.InternalPermissionService/CreateAdministrator" \
        "$org_admin_body" "$TOKEN" "$ZITADEL_URL"
}

list_internal_instance_roles() {
    local user_id="$1"
    local request_body response

    request_body='{"pagination":{"limit":500},"filters":[{"resource":{"instance":true}}]}'
    response=$(zitadel_api "POST" \
        "/zitadel.internal_permission.v2.InternalPermissionService/ListAdministrators" \
        "$request_body" "$TOKEN" "$ZITADEL_URL")
    echo "$response" | jq -c \
        --arg userId "$user_id" \
        '[.administrators[]? | select(.user.id == $userId) | .roles[]?] | unique'
}

update_internal_instance_roles() {
    local user_id="$1"
    local roles_json="$2"

    local update_body
    update_body=$(jq -cn \
        --arg userId "$user_id" \
        --argjson roles "$roles_json" \
        '{userId:$userId,resource:{instance:true},roles:$roles}')
    zitadel_api "POST" \
        "/zitadel.internal_permission.v2.InternalPermissionService/UpdateAdministrator" \
        "$update_body" "$TOKEN" "$ZITADEL_URL"
}

create_internal_instance_role() {
    local user_id="$1"
    local role="$2"

    local instance_admin_body
    instance_admin_body=$(jq -cn \
        --arg userId "$user_id" \
        --arg role "$role" \
        '{userId:$userId,resource:{instance:true},roles:[$role]}')
    zitadel_api "POST" \
        "/zitadel.internal_permission.v2.InternalPermissionService/CreateAdministrator" \
        "$instance_admin_body" "$TOKEN" "$ZITADEL_URL"
}

grant_internal_org_role() {
    local user_id="$1"
    local organization_id="$2"
    local role="$3"
    local label="$4"

    if [ -z "$user_id" ] || [ -z "$organization_id" ] || [ -z "$role" ]; then
        echo "ERROR: Missing input while granting $label" >&2
        exit 1
    fi

    local org_role_response current_roles merged_roles update_response
    org_role_response=$(create_internal_org_role "$user_id" "$organization_id" "$role")
    if echo "$org_role_response" | jq -e '.creationDate' >/dev/null 2>&1; then
        echo "  $label granted"
        return
    fi

    if echo "$org_role_response" | is_zitadel_already_exists; then
        current_roles=$(list_internal_org_roles "$user_id" "$organization_id")
        merged_roles=$(merge_internal_org_role "$current_roles" "$role")
        update_response=$(update_internal_org_roles "$user_id" "$organization_id" "$merged_roles")
        if echo "$update_response" | jq -e '.changeDate' >/dev/null 2>&1; then
            echo "  $label granted"
            return
        fi

        echo "ERROR: Failed to update $label" >&2
        echo "$update_response" >&2
        exit 1
    fi

    echo "ERROR: Failed to grant $label" >&2
    echo "$org_role_response" >&2
    exit 1
}

grant_internal_instance_role() {
    local user_id="$1"
    local role="$2"
    local label="$3"

    if [ -z "$user_id" ] || [ -z "$role" ]; then
        echo "ERROR: Missing input while granting $label" >&2
        exit 1
    fi

    local role_response current_roles merged_roles update_response
    role_response=$(create_internal_instance_role "$user_id" "$role")
    if echo "$role_response" | jq -e '.creationDate' >/dev/null 2>&1; then
        echo "  $label granted"
        return
    fi

    if echo "$role_response" | is_zitadel_already_exists; then
        current_roles=$(list_internal_instance_roles "$user_id")
        merged_roles=$(merge_internal_org_role "$current_roles" "$role")
        update_response=$(update_internal_instance_roles "$user_id" "$merged_roles")
        if echo "$update_response" | jq -e '.changeDate' >/dev/null 2>&1; then
            echo "  $label granted"
            return
        fi

        echo "ERROR: Failed to update $label" >&2
        echo "$update_response" >&2
        exit 1
    fi

    echo "ERROR: Failed to grant $label" >&2
    echo "$role_response" >&2
    exit 1
}

ensure_login_client_user() {
    local user_name="login-client"
    local pat_expiry_days pat_expiry existing_user create_machine_body response

    echo ""
    echo "--- Login Client Service User: $user_name ---"

    pat_expiry_days="${ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS:?ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS is required}"
    pat_expiry=$(date -u -d "+${pat_expiry_days} days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
              || date -u -v"+${pat_expiry_days}d" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
              || true)
    if [ -z "$pat_expiry" ]; then
        echo "ERROR: Could not compute Login Client PAT expiry timestamp." >&2
        exit 1
    fi
    PAT_BODY=$(jq -cn --arg expirationDate "$pat_expiry" '{expirationDate:$expirationDate}')

    LOGIN_CLIENT_PAT="${LOGIN_CLIENT_PAT:-$(state_var ZITADEL_LOGIN_CLIENT_TOKEN)}"
    existing_user=$(search_resource \
        "/v2/users" \
        "{\"query\":{\"limit\":1},\"queries\":[{\"userNameQuery\":{\"userName\":\"${user_name}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
        "result")

    if [ -n "$existing_user" ]; then
        LOGIN_CLIENT_USER_ID=$(echo "$existing_user" | jq -r '.userId')
        echo "  Login client user exists: $LOGIN_CLIENT_USER_ID"
    else
        echo "  Creating login client user (machine type)..."
        create_machine_body=$(jq -cn \
            --arg organizationId "$DEFAULT_ORGANIZATION_ID" \
            --arg username "$user_name" \
            '{
                organizationId: $organizationId,
                username: $username,
                machine: {
                    name: "Login Client",
                    description: "Service account for the self-hosted ZITADEL Login UI",
                    accessTokenType: "ACCESS_TOKEN_TYPE_BEARER"
                }
            }')
        response=$(zitadel_api "POST" "/v2/users/new" \
            "$create_machine_body" "$TOKEN" "$ZITADEL_URL")
        LOGIN_CLIENT_USER_ID=$(echo "$response" | jq -r '.id // empty')
        if [ -z "$LOGIN_CLIENT_USER_ID" ]; then
            echo "ERROR: Login client user creation did not return id" >&2
            echo "$response" >&2
            exit 1
        fi
        echo "  Created login client user: $LOGIN_CLIENT_USER_ID"
    fi

    grant_internal_instance_role \
        "$LOGIN_CLIENT_USER_ID" \
        "IAM_LOGIN_CLIENT" \
        "instance login-client role"

    if [ -z "$LOGIN_CLIENT_PAT" ]; then
        echo "  No saved Login Client PAT found — generating new PAT..."
        LOGIN_CLIENT_PAT=$(create_service_pat "$LOGIN_CLIENT_USER_ID")
        echo "  Login Client PAT generated"
    else
        echo "  Using saved Login Client PAT from state file"
    fi

    write_login_client_pat_file "$LOGIN_CLIENT_PAT"
    echo "  Login Client PAT written to bootstrap volume"
}

get_user_resource_owner() {
    local user_id="$1"
    local response
    response=$(zitadel_api "GET" "/v2/users/${user_id}" "" "$TOKEN" "$ZITADEL_URL")
    echo "$response" | jq -r '.user.details.resourceOwner // .details.resourceOwner // empty'
}

ensure_platform_admin_user() {
    local existing_user create_user_body user_response
    local existing_resource_owner
    local change_required
    PLATFORM_ADMIN_PASSWORD="$FM_PLATFORM_ADMIN_PASSWORD"
    change_required=$(bootstrap_password_change_required)

    echo ""
    echo "--- FM Platform Admin User: $FM_PLATFORM_ADMIN_USER ---"

    existing_user=$(search_resource \
        "/v2/users" \
        "{\"query\":{\"limit\":1},\"queries\":[{\"userNameQuery\":{\"userName\":\"${FM_PLATFORM_ADMIN_USER}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
        "result")

    if [ -n "$existing_user" ]; then
        PLATFORM_ADMIN_USER_ID=$(echo "$existing_user" | jq -r '.userId')
        echo "  Platform admin user exists: $PLATFORM_ADMIN_USER_ID"
        existing_resource_owner=$(get_user_resource_owner "$PLATFORM_ADMIN_USER_ID")
        if [ "$existing_resource_owner" != "$PLATFORM_ORGANIZATION_ID" ]; then
            echo "ERROR: Platform admin user belongs to org ${existing_resource_owner:-unknown}, expected $PLATFORM_ORGANIZATION_ID" >&2
            exit 1
        fi
        echo "  Existing platform admin password is not changed; env password must match Zitadel."
    else
        echo "  Creating platform admin user..."
        create_user_body=$(jq -cn \
            --arg organizationId "$PLATFORM_ORGANIZATION_ID" \
            --arg username "$FM_PLATFORM_ADMIN_USER" \
            --arg email "$FM_PLATFORM_ADMIN_EMAIL" \
            --arg password "$PLATFORM_ADMIN_PASSWORD" \
            --argjson changeRequired "$change_required" \
            '{
                organizationId: $organizationId,
                username: $username,
                human: {
                    profile: {givenName: "FM", familyName: "Platform Admin", displayName: "FM Platform Admin"},
                    email: {email: $email, isVerified: true},
                    password: {password: $password, changeRequired: $changeRequired}
                }
            }')
        user_response=$(zitadel_api "POST" "/v2/users/new" \
            "$create_user_body" "$TOKEN" "$ZITADEL_URL")
        PLATFORM_ADMIN_USER_ID=$(echo "$user_response" | jq -r '.id // empty')
        if [ -z "$PLATFORM_ADMIN_USER_ID" ]; then
            echo "ERROR: Platform admin user creation did not return id" >&2
            echo "$user_response" | jq 'del(.password)' >&2
            exit 1
        fi
        echo "  Created platform admin user: $PLATFORM_ADMIN_USER_ID"
    fi

    echo "  Granting ${FM_PLATFORM_ADMIN_ROLE} at instance level..."
    grant_internal_instance_role \
        "$PLATFORM_ADMIN_USER_ID" \
        "$FM_PLATFORM_ADMIN_ROLE" \
        "provider support role"

    # Puts FM project in this user's PAT aud via the cross-org grant.
    echo "  Granting admin role on FM project (via cross-org project grant)..."
    ensure_project_authorization \
        "$PLATFORM_ADMIN_USER_ID" \
        "$PROJECT_ID" \
        "$PLATFORM_ORGANIZATION_ID" \
        "admin"

    echo "  Platform admin ready"
}

ensure_fm_admin_user() {
    local existing_user create_user_body user_response
    local change_required
    change_required=$(bootstrap_password_change_required)

    echo ""
    echo "--- FM Admin User: $TEST_USER_NAME ---"

    local TENANT_ADMIN_EMAIL
    if [ -n "${CLIENT_DOMAIN:-}" ]; then
        TENANT_ADMIN_EMAIL="admin@${CLIENT_DOMAIN}"
    else
        TENANT_ADMIN_EMAIL="$FM_ADMIN_EMAIL"
    fi

    existing_user=$(search_resource \
        "/v2/users" \
        "{\"query\":{\"limit\":1},\"queries\":[{\"userNameQuery\":{\"userName\":\"${TEST_USER_NAME}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
        "result")

    if [ -n "$existing_user" ]; then
        TEST_USER_ID=$(echo "$existing_user" | jq -r '.userId')
        echo "  FM admin user exists: $TEST_USER_ID"
    else
        echo "  Creating FM admin user (CreateUser v2 — pre-verified, password-change policy applied)..."
        create_user_body=$(jq -cn \
            --arg organizationId "$ORGANIZATION_ID" \
            --arg username "$TEST_USER_NAME" \
            --arg email "$TENANT_ADMIN_EMAIL" \
            --arg password "$TEST_USER_PASSWORD" \
            --argjson changeRequired "$change_required" \
            '{
                organizationId: $organizationId,
                username: $username,
                human: {
                    profile: {givenName: "FM", familyName: "Admin", displayName: "FM Admin"},
                    email: {email: $email, isVerified: true},
                    password: {password: $password, changeRequired: $changeRequired}
                }
            }')
        user_response=$(zitadel_api "POST" "/v2/users/new" \
            "$create_user_body" "$TOKEN" "$ZITADEL_URL")
        TEST_USER_ID=$(echo "$user_response" | jq -r '.id // empty')
        if [ -z "$TEST_USER_ID" ]; then
            echo "ERROR: FM admin user creation did not return id" >&2
            echo "$user_response" | jq 'del(.password)' >&2
            exit 1
        fi
        echo "  Created FM admin user: $TEST_USER_ID"
    fi

    # Post-create duplicate-email guard. If a previous botched deploy left
    # a stale user with the same email, Zitadel returns "Multiple users
    # found" on the login screen and the admin can't sign in. Detect now
    # and fail loud rather than at first login.
    local email_dup_count
    email_dup_count=$(search_resource \
        "/v2/users" \
        "{\"query\":{\"limit\":10},\"queries\":[{\"emailQuery\":{\"emailAddress\":\"${TENANT_ADMIN_EMAIL}\"}}]}" \
        "result" | jq -s 'length' 2>/dev/null || echo 0)
    if [ "${email_dup_count:-1}" -gt 1 ]; then
        echo "ERROR: Multiple users found with email ${TENANT_ADMIN_EMAIL} (count=${email_dup_count})" >&2
        echo "  → login will fail with 'Multiple users found' — clean up stale users in Zitadel" >&2
        exit 1
    fi

    echo "  Granting admin role on project..."
    ensure_project_authorization "$TEST_USER_ID" "$PROJECT_ID" "$ORGANIZATION_ID" "admin"
    echo "  Admin role granted"
}

ensure_root_admin_user() {
    local root_user_id root_email root_user_json existing_email email_response

    echo "  Granting root user admin role on project..."
    root_user_id=$(search_resource \
        "/v2/users" \
        "{\"query\":{\"limit\":1},\"queries\":[{\"userNameQuery\":{\"userName\":\"root\",\"method\":\"TEXT_QUERY_METHOD_STARTS_WITH\"}}]}" \
        "result" | jq -r '.userId // .id // empty')

    if [ -z "$root_user_id" ]; then
        echo "  WARNING: Could not find root user to grant admin role" >&2
        return 0
    fi

    ensure_project_authorization "$root_user_id" "$PROJECT_ID" "$ORGANIZATION_ID" "admin"
    echo "  Root user ($root_user_id) granted admin role"

    root_email="root@${ZITADEL_HOSTNAME}"
    root_user_json=$(zitadel_api "GET" "/v2/users/${root_user_id}" "" "$TOKEN" "$ZITADEL_URL")
    existing_email=$(echo "$root_user_json" | jq -r '.user.human.email.email // empty')
    if [ -z "$existing_email" ]; then
        echo "  Setting email on root user (required for Login V2)..."
        email_response=$(zitadel_api "POST" "/v2/users/${root_user_id}/email" \
            "$(jq -cn --arg email "$root_email" '{email:$email,isVerified:true}')" \
            "$TOKEN" "$ZITADEL_URL")
        if echo "$email_response" | jq -e '.details' >/dev/null 2>&1; then
            echo "  Root user email set: $root_email"
        else
            echo "  WARNING: Could not set root user email" >&2
            echo "$email_response" >&2
        fi
    else
        echo "  Root user email already set: $existing_email"
    fi
}

ensure_service_user() {
    local pat_expiry_days pat_expiry existing_service_user create_machine_body
    local su_response existing_user svc_key_dir svc_key_response svc_key_details
    local org_admin_body org_role_response

    SERVICE_USER_NAME="${SERVICE_USER_NAME_OVERRIDE:-${ZITADEL_PROJECT_NAME}-service}"
    echo ""
    echo "--- Service User: $SERVICE_USER_NAME ---"

    pat_expiry_days="${ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS:?ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS is required}"
    pat_expiry=$(date -u -d "+${pat_expiry_days} days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
              || date -u -v"+${pat_expiry_days}d" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
              || true)
    if [ -z "$pat_expiry" ]; then
        echo "ERROR: Could not compute PAT expiry timestamp." >&2
        exit 1
    fi
    echo "  PAT expiry: $pat_expiry (${pat_expiry_days} days)"
    PAT_BODY=$(jq -cn --arg expirationDate "$pat_expiry" '{expirationDate:$expirationDate}')

    SERVICE_PAT=""

    existing_service_user=$(search_resource \
        "/v2/users" \
        "{\"query\":{\"limit\":1},\"queries\":[{\"userNameQuery\":{\"userName\":\"${SERVICE_USER_NAME}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
        "result")

    if [ -n "$existing_service_user" ]; then
        SERVICE_USER_ID=$(echo "$existing_service_user" | jq -r '.userId')
        echo "  Service user exists: $SERVICE_USER_ID"

        if [ -f "$STATE_FILE" ]; then
            SERVICE_PAT=$(grep -oP '^ZITADEL_SERVICE_TOKEN=\K.*' "$STATE_FILE" 2>/dev/null || true)
        fi

        if [ -n "$SERVICE_PAT" ]; then
            echo "  Using saved PAT from state file"
        else
            echo "  No saved PAT found — generating new PAT..."
            SERVICE_PAT=$(create_service_pat "$SERVICE_USER_ID")
            echo "  PAT generated"
        fi
    else
        echo "  Creating service user (machine type)..."
        create_machine_body=$(jq -cn \
            --arg organizationId "$ORGANIZATION_ID" \
            --arg username "$SERVICE_USER_NAME" \
            '{
                organizationId: $organizationId,
                username: $username,
                machine: {
                    name: "Fleet Manager Service",
                    description: "Backend service account for Management API access",
                    accessTokenType: "ACCESS_TOKEN_TYPE_BEARER"
                }
            }')
        su_response=$(zitadel_api "POST" "/v2/users/new" \
            "$create_machine_body" "$TOKEN" "$ZITADEL_URL")
        SERVICE_USER_ID=$(echo "$su_response" | jq -r '.id // empty')
        if [ -z "$SERVICE_USER_ID" ]; then
            echo "ERROR: Service user creation did not return id" >&2
            echo "$su_response" >&2
            exit 1
        fi
        echo "  Created service user: $SERVICE_USER_ID"

        echo "  Generating PAT..."
        SERVICE_PAT=$(create_service_pat "$SERVICE_USER_ID")
        echo "  PAT generated"
    fi

    if [ "$FM_ZITADEL_SERVICE_AUTH" = "jwt-profile" ] && [ -n "$SERVICE_USER_ID" ]; then
        if [ -f "$ZITADEL_SERVICE_KEY_FILE" ]; then
            existing_user=$(jq -r '.userId // empty' \
                "$ZITADEL_SERVICE_KEY_FILE" 2>/dev/null || true)
            if [ -n "$existing_user" ] && \
               [ "$existing_user" != "$SERVICE_USER_ID" ]; then
                echo "  Service key file points at deleted user ${existing_user} (current: ${SERVICE_USER_ID}); regenerating."
                rm -f "$ZITADEL_SERVICE_KEY_FILE"
            fi
        fi
        if [ -f "$ZITADEL_SERVICE_KEY_FILE" ]; then
            echo "  Service-user key file exists: $ZITADEL_SERVICE_KEY_FILE"
        else
            echo "  Generating service-user machine key..."
            svc_key_dir="$(dirname "$ZITADEL_SERVICE_KEY_FILE")"
            mkdir -p "$svc_key_dir"
            chmod 0700 "$svc_key_dir"
            export ZITADEL_ORG_HEADER="$ORGANIZATION_ID"
            svc_key_response=$(zitadel_api "POST" \
                "/management/v1/users/${SERVICE_USER_ID}/keys" \
                '{"type":"KEY_TYPE_JSON"}' "$TOKEN" "$ZITADEL_URL")
            unset ZITADEL_ORG_HEADER
            svc_key_details=$(echo "$svc_key_response" | jq -r '.keyDetails // empty')
            if [ -z "$svc_key_details" ]; then
                echo "ERROR: machine-user key generation did not return keyDetails" >&2
                echo "$svc_key_response" >&2
                exit 1
            fi
            echo "$svc_key_details" | base64 -d > "${ZITADEL_SERVICE_KEY_FILE}.tmp"
            chmod 0600 "${ZITADEL_SERVICE_KEY_FILE}.tmp"
            mv "${ZITADEL_SERVICE_KEY_FILE}.tmp" "$ZITADEL_SERVICE_KEY_FILE"
            echo "  Saved key file: $ZITADEL_SERVICE_KEY_FILE"
        fi
    fi

    if [ -n "$SERVICE_USER_ID" ]; then
        echo "  Granting ORG_USER_MANAGER role..."
        grant_internal_org_role \
            "$SERVICE_USER_ID" \
            "$ORGANIZATION_ID" \
            "ORG_USER_MANAGER" \
            "tenant identity-management role"
        echo "  Granting instance support-verification role..."
        grant_internal_instance_role \
            "$SERVICE_USER_ID" \
            "$FM_PLATFORM_SUPPORT_READ_ROLE" \
            "instance support-verification role"
        echo "  Granting runtime instance-management role..."
        grant_internal_instance_role \
            "$SERVICE_USER_ID" \
            "$FM_ZITADEL_SERVICE_INSTANCE_ROLE" \
            "runtime instance-management role"
    fi

    if [ -n "$SERVICE_USER_ID" ] && [ -n "$PROJECT_ID" ]; then
        echo "  Granting FM project admin role..."
        ensure_project_authorization "$SERVICE_USER_ID" "$PROJECT_ID" "$ORGANIZATION_ID" "admin"
        echo "  FM project admin granted"
    fi
}

ensure_node_red_service_user() {
    local enabled="${FM_NODE_RED_ADDON_ENABLED:-${FM_NODE_RED_ENABLED:-false}}"
    local existing_user create_machine_body response metadata_body
    local permissions_json permissions_b64 group_b64
    local pat_expiry_days pat_expiry

    NODE_RED_SERVICE_USER_ID="${NODE_RED_SERVICE_USER_ID:-$(state_var FM_NODE_RED_SERVICE_USER_ID)}"
    NODE_RED_SERVICE_PAT="${NODE_RED_SERVICE_PAT:-$(state_var FM_NODE_RED_SERVICE_TOKEN)}"
    NODE_RED_PROXY_SECRET="${FM_NODE_RED_PROXY_SECRET:-$(state_var FM_NODE_RED_PROXY_SECRET)}"
    NODE_RED_CREDENTIAL_SECRET="${FM_NODE_RED_CREDENTIAL_SECRET:-$(state_var FM_NODE_RED_CREDENTIAL_SECRET)}"
    NODE_RED_PERMISSIONS="${FM_NODE_RED_PERMISSIONS:-$(state_var FM_NODE_RED_PERMISSIONS)}"
    # Least privilege: read + control devices, run actions. No device:write.
    NODE_RED_PERMISSIONS="${NODE_RED_PERMISSIONS:-device:read,device:execute,action:execute}"

    if [ "$enabled" != "true" ]; then
        return 0
    fi

    NODE_RED_SERVICE_USER_NAME="${NODE_RED_SERVICE_USER_NAME_OVERRIDE:-fleet-nodered}"
    if [ -n "${CLIENT_ID:-}" ]; then
        NODE_RED_SERVICE_USER_NAME="${NODE_RED_SERVICE_USER_NAME_OVERRIDE:-${ZITADEL_PROJECT_NAME}-${CLIENT_ID}-nodered}"
    fi

    echo ""
    echo "--- Node-RED Service User: $NODE_RED_SERVICE_USER_NAME ---"

    if [ -z "$NODE_RED_PROXY_SECRET" ]; then
        NODE_RED_PROXY_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)"
        echo "  Generated proxy secret"
    else
        echo "  Proxy secret exists"
    fi

    if [ -z "$NODE_RED_CREDENTIAL_SECRET" ]; then
        NODE_RED_CREDENTIAL_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)"
        echo "  Generated credential secret"
    else
        echo "  Credential secret exists"
    fi

    pat_expiry_days="${ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS:?ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS is required}"
    pat_expiry=$(date -u -d "+${pat_expiry_days} days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
              || date -u -v"+${pat_expiry_days}d" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
              || true)
    if [ -z "$pat_expiry" ]; then
        echo "ERROR: Could not compute Node-RED PAT expiry timestamp." >&2
        exit 1
    fi
    PAT_BODY=$(jq -cn --arg expirationDate "$pat_expiry" '{expirationDate:$expirationDate}')

    existing_user=$(search_resource \
        "/v2/users" \
        "{\"query\":{\"limit\":1},\"queries\":[{\"userNameQuery\":{\"userName\":\"${NODE_RED_SERVICE_USER_NAME}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
        "result")

    if [ -n "$existing_user" ]; then
        NODE_RED_SERVICE_USER_ID=$(echo "$existing_user" | jq -r '.userId')
        echo "  Node-RED service user exists: $NODE_RED_SERVICE_USER_ID"
        if [ -n "$NODE_RED_SERVICE_PAT" ]; then
            echo "  Using saved Node-RED PAT from state file"
        else
            echo "  No saved Node-RED PAT found — generating new PAT..."
            NODE_RED_SERVICE_PAT=$(create_service_pat "$NODE_RED_SERVICE_USER_ID")
            echo "  Node-RED PAT generated"
        fi
    else
        echo "  Creating Node-RED service user (machine type)..."
        create_machine_body=$(jq -cn \
            --arg organizationId "$ORGANIZATION_ID" \
            --arg username "$NODE_RED_SERVICE_USER_NAME" \
            '{
                organizationId: $organizationId,
                username: $username,
                machine: {
                    name: "Fleet Manager Node-RED",
                    description: "Standalone Node-RED automation runtime service account",
                    accessTokenType: "ACCESS_TOKEN_TYPE_BEARER"
                }
            }')
        response=$(zitadel_api "POST" "/v2/users/new" \
            "$create_machine_body" "$TOKEN" "$ZITADEL_URL")
        NODE_RED_SERVICE_USER_ID=$(echo "$response" | jq -r '.id // empty')
        if [ -z "$NODE_RED_SERVICE_USER_ID" ]; then
            echo "ERROR: Node-RED service user creation did not return id" >&2
            echo "$response" >&2
            exit 1
        fi
        echo "  Created Node-RED service user: $NODE_RED_SERVICE_USER_ID"

        echo "  Generating Node-RED PAT..."
        NODE_RED_SERVICE_PAT=$(create_service_pat "$NODE_RED_SERVICE_USER_ID")
        echo "  Node-RED PAT generated"
    fi

    permissions_json="$(csv_to_json_array "$NODE_RED_PERMISSIONS")"
    permissions_b64="$(printf '%s' "$permissions_json" | base64 | tr -d '\n')"
    group_b64="$(printf 'automation_service' | base64 | tr -d '\n')"
    metadata_body=$(jq -cn \
        --arg permissions "$permissions_b64" \
        --arg group "$group_b64" \
        '{metadata:[
            {key:"fleet_permissions",value:$permissions},
            {key:"fleet_group",value:$group}
        ]}')
    response=$(zitadel_api "POST" "/v2/users/${NODE_RED_SERVICE_USER_ID}/metadata" \
        "$metadata_body" "$TOKEN" "$ZITADEL_URL")
    if echo "$response" | jq -e 'has("code") or has("error")' >/dev/null 2>&1; then
        echo "ERROR: Failed to set Node-RED service metadata" >&2
        echo "$response" >&2
        exit 1
    fi
    echo "  Metadata set: $NODE_RED_PERMISSIONS"
}

ensure_grafana_service_user() {
    local enabled="${FM_GRAFANA_ADDON_ENABLED:-false}"
    local existing_user create_machine_body response metadata_body
    local permissions_json permissions_b64 group_b64
    local pat_expiry_days pat_expiry

    GRAFANA_SERVICE_USER_ID="${GRAFANA_SERVICE_USER_ID:-$(state_var FM_GRAFANA_SERVICE_USER_ID)}"
    GRAFANA_SERVICE_PAT="${GRAFANA_SERVICE_PAT:-$(state_var FM_GRAFANA_SERVICE_TOKEN)}"
    GRAFANA_PROXY_SECRET="${FM_GRAFANA_PROXY_SECRET:-$(state_var FM_GRAFANA_PROXY_SECRET)}"
    GRAFANA_PERMISSIONS="${FM_GRAFANA_PERMISSIONS:-$(state_var FM_GRAFANA_PERMISSIONS)}"
    GRAFANA_PERMISSIONS="${GRAFANA_PERMISSIONS:-grafana:read}"

    if [ "$enabled" != "true" ]; then
        return 0
    fi

    GRAFANA_SERVICE_USER_NAME="${GRAFANA_SERVICE_USER_NAME_OVERRIDE:-fleet-grafana}"
    if [ -n "${CLIENT_ID:-}" ]; then
        GRAFANA_SERVICE_USER_NAME="${GRAFANA_SERVICE_USER_NAME_OVERRIDE:-${ZITADEL_PROJECT_NAME}-${CLIENT_ID}-grafana}"
    fi

    echo ""
    echo "--- Grafana Service User: $GRAFANA_SERVICE_USER_NAME ---"

    if [ -z "$GRAFANA_PROXY_SECRET" ]; then
        GRAFANA_PROXY_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)"
        echo "  Generated proxy secret"
    else
        echo "  Proxy secret exists"
    fi

    pat_expiry_days="${ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS:?ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS is required}"
    pat_expiry=$(date -u -d "+${pat_expiry_days} days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
              || date -u -v"+${pat_expiry_days}d" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
              || true)
    if [ -z "$pat_expiry" ]; then
        echo "ERROR: Could not compute Grafana PAT expiry timestamp." >&2
        exit 1
    fi
    PAT_BODY=$(jq -cn --arg expirationDate "$pat_expiry" '{expirationDate:$expirationDate}')

    existing_user=$(search_resource \
        "/v2/users" \
        "{\"query\":{\"limit\":1},\"queries\":[{\"userNameQuery\":{\"userName\":\"${GRAFANA_SERVICE_USER_NAME}\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
        "result")

    if [ -n "$existing_user" ]; then
        GRAFANA_SERVICE_USER_ID=$(echo "$existing_user" | jq -r '.userId')
        echo "  Grafana service user exists: $GRAFANA_SERVICE_USER_ID"
        if [ -n "$GRAFANA_SERVICE_PAT" ]; then
            echo "  Using saved Grafana PAT from state file"
        else
            echo "  No saved Grafana PAT found — generating new PAT..."
            GRAFANA_SERVICE_PAT=$(create_service_pat "$GRAFANA_SERVICE_USER_ID")
            echo "  Grafana PAT generated"
        fi
    else
        echo "  Creating Grafana service user (machine type)..."
        create_machine_body=$(jq -cn \
            --arg organizationId "$ORGANIZATION_ID" \
            --arg username "$GRAFANA_SERVICE_USER_NAME" \
            '{
                organizationId: $organizationId,
                username: $username,
                machine: {
                    name: "Fleet Manager Grafana",
                    description: "Grafana datasource service account for Fleet Manager callbacks",
                    accessTokenType: "ACCESS_TOKEN_TYPE_BEARER"
                }
            }')
        response=$(zitadel_api "POST" "/v2/users/new" \
            "$create_machine_body" "$TOKEN" "$ZITADEL_URL")
        GRAFANA_SERVICE_USER_ID=$(echo "$response" | jq -r '.id // empty')
        if [ -z "$GRAFANA_SERVICE_USER_ID" ]; then
            echo "ERROR: Grafana service user creation did not return id" >&2
            echo "$response" >&2
            exit 1
        fi
        echo "  Created Grafana service user: $GRAFANA_SERVICE_USER_ID"

        echo "  Generating Grafana PAT..."
        GRAFANA_SERVICE_PAT=$(create_service_pat "$GRAFANA_SERVICE_USER_ID")
        echo "  Grafana PAT generated"
    fi

    permissions_json="$(csv_to_json_array "$GRAFANA_PERMISSIONS")"
    permissions_b64="$(printf '%s' "$permissions_json" | base64 | tr -d '\n')"
    group_b64="$(printf 'automation_service' | base64 | tr -d '\n')"
    metadata_body=$(jq -cn \
        --arg permissions "$permissions_b64" \
        --arg group "$group_b64" \
        '{metadata:[
            {key:"fleet_permissions",value:$permissions},
            {key:"fleet_group",value:$group}
        ]}')
    response=$(zitadel_api "POST" "/v2/users/${GRAFANA_SERVICE_USER_ID}/metadata" \
        "$metadata_body" "$TOKEN" "$ZITADEL_URL")
    if echo "$response" | jq -e 'has("code") or has("error")' >/dev/null 2>&1; then
        echo "ERROR: Failed to set Grafana service metadata" >&2
        echo "$response" >&2
        exit 1
    fi
    echo "  Metadata set: $GRAFANA_PERMISSIONS"
}
