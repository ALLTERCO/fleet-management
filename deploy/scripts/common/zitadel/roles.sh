# shellcheck shell=bash
# shellcheck disable=SC2153  # TOKEN, PROJECT_ID, ZITADEL_URL set in bootstrap-zitadel.sh
SYSTEM_PERSONA_ROLE_KEYS=(
    admin
    manager
    editor
    installer
    operator
    automation_admin
    auditor
    viewer
)

ensure_project_role() {
    local project_id="$1"
    local role_key="$2"
    local display_name="$3"
    local response
    response=$(zitadel_api "POST" "/zitadel.project.v2.ProjectService/AddProjectRole" \
        "$(jq -cn --arg projectId "$project_id" --arg roleKey "$role_key" --arg displayName "$display_name" \
            '{projectId:$projectId,roleKey:$roleKey,displayName:$displayName}')" \
        "$TOKEN" "$ZITADEL_URL")
    if echo "$response" | is_zitadel_already_exists; then
        return 0
    fi
    if echo "$response" | jq -e '.creationDate' >/dev/null 2>&1; then
        return 0
    fi
    echo "$response" >&2
    return 1
}

ensure_project_authorization() {
    local user_id="$1"
    local project_id="$2"
    local organization_id="$3"
    shift 3
    local role_keys=("$@")
    local response
    response=$(zitadel_api "POST" "/zitadel.authorization.v2.AuthorizationService/ListAuthorizations" \
        '{"pagination":{"limit":1000}}' "$TOKEN" "$ZITADEL_URL")
    local authorization
    authorization=$(echo "$response" | jq -r \
        --arg userId "$user_id" \
        --arg projectId "$project_id" \
        --arg organizationId "$organization_id" \
        '(.authorizations // []) | map(select(.user.id == $userId and .project.id == $projectId and .organization.id == $organizationId)) | .[0] // empty')
    local role_keys_json
    role_keys_json=$(printf '%s\n' "${role_keys[@]}" | jq -R . | jq -s .)
    if [ -n "$authorization" ]; then
        local authorization_id
        authorization_id=$(echo "$authorization" | jq -r '.id')
        response=$(zitadel_api "POST" "/zitadel.authorization.v2.AuthorizationService/UpdateAuthorization" \
            "$(jq -cn --arg id "$authorization_id" --argjson roleKeys "$role_keys_json" \
                '{id:$id,roleKeys:$roleKeys}')" \
            "$TOKEN" "$ZITADEL_URL")
        if echo "$response" | is_zitadel_no_change; then
            return 0
        fi
        if echo "$response" | jq -e '.changeDate' >/dev/null 2>&1; then
            return 0
        fi
        echo "$response" >&2
        return 1
    fi
    response=$(zitadel_api "POST" "/zitadel.authorization.v2.AuthorizationService/CreateAuthorization" \
        "$(jq -cn \
            --arg userId "$user_id" \
            --arg projectId "$project_id" \
            --arg organizationId "$organization_id" \
            --argjson roleKeys "$role_keys_json" \
            '{userId:$userId,projectId:$projectId,organizationId:$organizationId,roleKeys:$roleKeys}')" \
        "$TOKEN" "$ZITADEL_URL")
    if echo "$response" | is_zitadel_already_exists; then
        return 0
    fi
    if echo "$response" | jq -e '.id' >/dev/null 2>&1; then
        return 0
    fi
    echo "$response" >&2
    return 1
}

system_persona_display_name() {
    case "$1" in
        admin) echo "Administrator" ;;
        manager) echo "Manager" ;;
        editor) echo "Editor" ;;
        installer) echo "Installer" ;;
        operator) echo "Operator" ;;
        automation_admin) echo "Automation Admin" ;;
        auditor) echo "Auditor" ;;
        viewer) echo "Viewer" ;;
        *) echo "$1" ;;
    esac
}

ensure_system_persona_roles() {
    local role_key
    echo "  Adding system persona roles..."
    for role_key in "${SYSTEM_PERSONA_ROLE_KEYS[@]}"; do
        ensure_project_role "$PROJECT_ID" "$role_key" "$(system_persona_display_name "$role_key")"
    done
    echo "  Roles added"
}
