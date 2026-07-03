# shellcheck shell=bash
# shellcheck disable=SC2153  # TOKEN, PROJECT_NAME, ZITADEL_URL set in bootstrap-zitadel.sh
search_resource() {
    local path="$1"
    local body="$2"
    local result_key="$3"

    local response
    response=$(zitadel_api "POST" "$path" "$body" "$TOKEN" "$ZITADEL_URL")

    # Extract first result from the result array
    echo "$response" | jq -r "(.${result_key} // []) | .[0] // empty"
}

search_project_by_name_in_org() {
    local name="$1"
    local organization_id="$2"
    local body response
    body=$(jq -cn --arg name "$name" \
        '{pagination:{limit:1000},filters:[{projectNameFilter:{projectName:$name,method:"TEXT_FILTER_METHOD_EQUALS"}}]}')
    response=$(zitadel_api "POST" "/zitadel.project.v2.ProjectService/ListProjects" \
        "$body" "$TOKEN" "$ZITADEL_URL")
    echo "$response" | jq -r \
        --arg organizationId "$organization_id" \
        '(.projects // []) | map(select(.organizationId == $organizationId)) | .[0] // empty'
}

find_named_organization_id() {
    local org_name="$1"

    if [ -z "$org_name" ]; then
        echo "ERROR: organization name is required" >&2
        return 1
    fi
    local body response org_id
    body=$(jq -cn --arg name "$org_name" \
        '{query:{limit:1},queries:[{nameQuery:{name:$name,method:"TEXT_QUERY_METHOD_EQUALS"}}]}')
    response=$(zitadel_api "POST" "/v2/organizations/_search" "$body" "$TOKEN" "$ZITADEL_URL")
    org_id=$(echo "$response" | jq -r '(.result // []) | .[0].id // empty')
    echo "$org_id"
}

find_named_organization_id_case_insensitive() {
    local org_name="$1"

    if [ -z "$org_name" ]; then
        echo "ERROR: organization name is required" >&2
        return 1
    fi
    local body response org_id
    body='{"query":{"limit":1000}}'
    response=$(zitadel_api "POST" "/v2/organizations/_search" "$body" "$TOKEN" "$ZITADEL_URL")
    org_id=$(echo "$response" | jq -r \
        --arg name_lc "$(printf '%s' "$org_name" | tr '[:upper:]' '[:lower:]')" \
        '(.result // []) | map(select((.name // "" | ascii_downcase) == $name_lc)) | .[0].id // empty')
    echo "$org_id"
}

# Resolve or create a named org.
resolve_named_organization_id() {
    local org_name="$1"
    local stable_prefix="${2:-fm}"
    local org_id

    org_id=$(find_named_organization_id "$org_name")
    if [ -n "$org_id" ]; then
        echo "$org_id"
        return
    fi
    echo "  Creating organization: $org_name..." >&2
    local create_body
    if [ -n "${CLIENT_ID:-}" ]; then
        local stable_id
        stable_id=$(printf '%s-%s' "$stable_prefix" "$CLIENT_ID" | tr '[:upper:]' '[:lower:]' \
            | tr -c 'a-z0-9-' '-' | sed -E 's/-+/-/g; s/-+$//' | head -c 64)
        create_body=$(jq -cn --arg name "$org_name" --arg id "$stable_id" \
            '{name:$name, organizationId:$id}')
    else
        create_body=$(jq -cn --arg name "$org_name" '{name:$name}')
    fi
    response=$(zitadel_api "POST" "/v2/organizations" \
        "$create_body" "$TOKEN" "$ZITADEL_URL")
    org_id=$(echo "$response" | jq -r '.organizationId // empty')
    if [ -z "$org_id" ]; then
        echo "ERROR: Failed to create organization '$org_name'" >&2
        echo "$response" >&2
        return 1
    fi
    echo "  Organization created: $org_id" >&2
    echo "$org_id"
}

resolve_default_organization_id() {
    local org_id
    org_id=$(find_named_organization_id "$ZITADEL_DEFAULT_ORG_NAME")
    if [ -z "$org_id" ]; then
        org_id=$(find_named_organization_id_case_insensitive "$ZITADEL_DEFAULT_ORG_NAME")
    fi
    if [ -z "$org_id" ]; then
        echo "ERROR: Could not resolve default Zitadel organization '$ZITADEL_DEFAULT_ORG_NAME'" >&2
        return 1
    fi
    echo "$org_id"
}

resolve_tenant_organization_id() {
    resolve_named_organization_id "$FM_CLIENT_ORG_NAME" "fm-tenant"
}

resolve_platform_organization_id() {
    resolve_named_organization_id "$FM_PLATFORM_ORG_NAME" "fm-platform"
}

ensure_project() {
    local existing_project create_response project_update_response

    echo ""
    echo "--- Project: $PROJECT_NAME ---"

    DEFAULT_ORGANIZATION_ID=$(resolve_default_organization_id)
    if [ -z "$DEFAULT_ORGANIZATION_ID" ]; then
        exit 1
    fi

    ORGANIZATION_ID=$(resolve_tenant_organization_id)
    if [ -z "$ORGANIZATION_ID" ]; then
        echo "ERROR: Could not resolve tenant organization for project creation" >&2
        exit 1
    fi

    PLATFORM_ORGANIZATION_ID=$(resolve_platform_organization_id)
    if [ -z "$PLATFORM_ORGANIZATION_ID" ]; then
        echo "ERROR: Could not resolve platform organization for provider support authority" >&2
        exit 1
    fi

    existing_project=$(search_project_by_name_in_org "$PROJECT_NAME" "$ORGANIZATION_ID")

    if [ -n "$existing_project" ]; then
        PROJECT_ID=$(echo "$existing_project" | jq -r '.projectId // empty')
        if [ -z "$PROJECT_ID" ]; then
            echo "ERROR: Existing project lookup did not return projectId" >&2
            echo "$existing_project" >&2
            exit 1
        fi
        echo "  Project exists: $PROJECT_ID (org: $ORGANIZATION_ID)"
    else
        echo "  Creating project..."
        create_response=$(zitadel_api "POST" "/zitadel.project.v2.ProjectService/CreateProject" \
            "$(jq -cn --arg organizationId "$ORGANIZATION_ID" --arg name "$PROJECT_NAME" \
                '{organizationId:$organizationId,name:$name,projectRoleAssertion:true,authorizationRequired:true,projectAccessRequired:true,privateLabelingSetting:"PRIVATE_LABELING_SETTING_ALLOW_LOGIN_USER_RESOURCE_OWNER_POLICY"}')" \
            "$TOKEN" "$ZITADEL_URL")
        PROJECT_ID=$(echo "$create_response" | jq -r '.projectId // empty')
        if [ -z "$PROJECT_ID" ]; then
            echo "ERROR: Project creation did not return projectId" >&2
            echo "$create_response" >&2
            exit 1
        fi
        echo "  Created project: $PROJECT_ID (org: $ORGANIZATION_ID)"
    fi

    echo "  Updating project settings (role assertion enabled)..."
    project_update_response=$(zitadel_api "POST" "/zitadel.project.v2.ProjectService/UpdateProject" \
        "$(jq -cn --arg projectId "$PROJECT_ID" --arg name "$PROJECT_NAME" \
            '{projectId:$projectId,name:$name,projectRoleAssertion:true,authorizationRequired:true,projectAccessRequired:true,privateLabelingSetting:"PRIVATE_LABELING_SETTING_ALLOW_LOGIN_USER_RESOURCE_OWNER_POLICY"}')" \
        "$TOKEN" "$ZITADEL_URL")
    if ! echo "$project_update_response" | jq -e '.changeDate' >/dev/null 2>&1 && \
       ! echo "$project_update_response" | is_zitadel_no_change; then
        echo "ERROR: Failed to update project settings" >&2
        echo "$project_update_response" >&2
        exit 1
    fi
}

# Cross-org grant so platform-org PATs carry the FM project in aud.
ensure_platform_project_grant() {
    local response

    if [ "$ORGANIZATION_ID" = "$PLATFORM_ORGANIZATION_ID" ]; then
        return 0
    fi

    echo ""
    echo "--- Cross-org Project Grant: FM project -> platform org ---"

    response=$(zitadel_api "POST" \
        "/zitadel.project.v2.ProjectService/CreateProjectGrant" \
        "$(jq -cn --arg projectId "$PROJECT_ID" \
            --arg grantedOrgId "$PLATFORM_ORGANIZATION_ID" \
            '{projectId:$projectId,grantedOrganizationId:$grantedOrgId,roleKeys:["admin"]}')" \
        "$TOKEN" "$ZITADEL_URL")
    # V2 returns {creationDate, details}; V1 returned {grantId}.
    if echo "$response" | jq -e 'has("creationDate") or has("details") or has("grantId")' >/dev/null 2>&1; then
        echo "  Created project grant"
    elif echo "$response" | jq -e '.code == "already_exists"' >/dev/null 2>&1; then
        echo "  Project grant already exists (idempotent)"
    else
        echo "ERROR: Failed to create cross-org project grant" >&2
        echo "$response" >&2
        exit 1
    fi
}
