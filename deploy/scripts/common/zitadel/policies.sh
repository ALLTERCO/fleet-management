# shellcheck shell=bash
is_zitadel_no_change() {
    jq -e '(.message // "") | contains("No changes")' >/dev/null 2>&1
}

is_zitadel_already_exists() {
    jq -e '(.code // "") == "already_exists" or ((.message // "") | contains("already exists"))' >/dev/null 2>&1
}

upload_label_logo_at() {
    local api_path="$1" file_path="$2"
    [ -z "$file_path" ] && return 0
    if [ ! -f "$file_path" ]; then
        echo "  WARNING: logo not found at $file_path — skipped" >&2
        return 0
    fi
    local curl_args=(
        -sS -o /dev/null -w '%{http_code}'
        -X POST "${ZITADEL_URL}${api_path}"
        -H "Authorization: Bearer ${TOKEN}"
        -F "file=@${file_path}"
    )
    [ -n "${ZITADEL_HOST_HEADER:-}" ] && curl_args+=(-H "Host: ${ZITADEL_HOST_HEADER}")
    [ -n "${ZITADEL_ORG_HEADER:-}" ] && curl_args+=(-H "x-zitadel-orgid: ${ZITADEL_ORG_HEADER}")
    local code
    code=$(curl "${curl_args[@]}")
    if [ "$code" = "200" ]; then
        echo "  Uploaded logo from $file_path"
    else
        echo "  WARNING: logo upload to $api_path returned HTTP $code" >&2
    fi
}

# True iff at least one FM_BRAND_* override is set.
has_brand_overrides() {
    [ -n "${FM_BRAND_PRIMARY_COLOR:-}" ] && return 0
    [ -n "${FM_BRAND_WARN_COLOR:-}" ] && return 0
    [ -n "${FM_BRAND_BACKGROUND_COLOR:-}" ] && return 0
    [ -n "${FM_BRAND_FONT_COLOR:-}" ] && return 0
    [ -n "${FM_BRAND_PRIMARY_COLOR_DARK:-}" ] && return 0
    [ -n "${FM_BRAND_WARN_COLOR_DARK:-}" ] && return 0
    [ -n "${FM_BRAND_BACKGROUND_COLOR_DARK:-}" ] && return 0
    [ -n "${FM_BRAND_FONT_COLOR_DARK:-}" ] && return 0
    [ -n "${FM_BRAND_LOGO_PATH:-}" ] && return 0
    [ -n "${FM_BRAND_LOGO_DARK_PATH:-}" ] && return 0
    [ -n "${FM_BRAND_ICON_PATH:-}" ] && return 0
    [ -n "${FM_BRAND_ICON_DARK_PATH:-}" ] && return 0
    [ -n "${FM_BRAND_FONT_PATH:-}" ] && return 0
    [ -n "${FM_BRAND_THEME_MODE:-}" ] && return 0
    [ "${FM_BRAND_HIDE_LOGIN_NAME_SUFFIX:-}" = "true" ] && return 0
    [ "${FM_BRAND_DISABLE_WATERMARK:-}" = "true" ] && return 0
    return 1
}

has_privacy_overrides() {
    [ -n "${FM_PRIVACY_TOS_LINK:-}" ] && return 0
    [ -n "${FM_PRIVACY_PRIVACY_LINK:-}" ] && return 0
    [ -n "${FM_PRIVACY_HELP_LINK:-}" ] && return 0
    [ -n "${FM_PRIVACY_SUPPORT_EMAIL:-}" ] && return 0
    [ -n "${FM_PRIVACY_DOCS_LINK:-}" ] && return 0
    [ -n "${FM_PRIVACY_CUSTOM_LINK:-}" ] && return 0
    [ -n "${FM_PRIVACY_CUSTOM_LINK_TEXT:-}" ] && return 0
    return 1
}

configure_label_policy() {
    local label_get_path label_put_path label_activate_path
    local label_logo_path label_logo_dark_path label_icon_path label_icon_dark_path
    local label_font_path label_scope current_label label_body label_response
    local label_create_response activate_response

    if ! has_brand_overrides; then
        echo "Skipping label policy (no FM_BRAND_* overrides)"
        return 0
    fi

    # Per-client projects get an org-scoped label policy; single-instance uses instance scope.
    if [ -n "${CLIENT_ID:-}" ] && [ -n "${ORGANIZATION_ID:-}" ]; then
        label_get_path="/management/v1/policies/label"
        label_put_path="/management/v1/policies/label"
        label_activate_path="/management/v1/policies/label/_activate"
        label_logo_path="/assets/v1/org/policy/label/logo"
        label_logo_dark_path="/assets/v1/org/policy/label/logo/dark"
        label_icon_path="/assets/v1/org/policy/label/icon"
        label_icon_dark_path="/assets/v1/org/policy/label/icon/dark"
        label_font_path="/assets/v1/org/policy/label/font"
        label_scope="org $ORGANIZATION_ID"
        export ZITADEL_ORG_HEADER="$ORGANIZATION_ID"
    else
        label_get_path="/admin/v1/policies/label"
        label_put_path="/admin/v1/policies/label"
        label_activate_path="/admin/v1/policies/label/_activate"
        label_logo_path="/assets/v1/instance/policy/label/logo"
        label_logo_dark_path="/assets/v1/instance/policy/label/logo/dark"
        label_icon_path="/assets/v1/instance/policy/label/icon"
        label_icon_dark_path="/assets/v1/instance/policy/label/icon/dark"
        label_font_path="/assets/v1/instance/policy/label/font"
        label_scope="instance"
        unset ZITADEL_ORG_HEADER
    fi

    echo "Configuring label policy ($label_scope)..."
    current_label=$(zitadel_api "GET" "$label_get_path" "" "$TOKEN" "$ZITADEL_URL")
    if ! echo "$current_label" | jq empty 2>/dev/null; then
        current_label='{}'
    fi
    label_body=$(jq -cn \
        --argjson current "$current_label" \
        --arg primary       "${FM_BRAND_PRIMARY_COLOR:-}" \
        --arg warn          "${FM_BRAND_WARN_COLOR:-}" \
        --arg background    "${FM_BRAND_BACKGROUND_COLOR:-}" \
        --arg font          "${FM_BRAND_FONT_COLOR:-}" \
        --arg primaryDark   "${FM_BRAND_PRIMARY_COLOR_DARK:-}" \
        --arg warnDark      "${FM_BRAND_WARN_COLOR_DARK:-}" \
        --arg backgroundDark "${FM_BRAND_BACKGROUND_COLOR_DARK:-}" \
        --arg fontDark      "${FM_BRAND_FONT_COLOR_DARK:-}" \
        --arg hideSuffix    "${FM_BRAND_HIDE_LOGIN_NAME_SUFFIX:-}" \
        --arg disableMark   "${FM_BRAND_DISABLE_WATERMARK:-}" \
        --arg themeMode     "${FM_BRAND_THEME_MODE:-}" \
        '($current.policy // {})
        | {
            primaryColor, warnColor, backgroundColor, fontColor,
            primaryColorDark, warnColorDark, backgroundColorDark, fontColorDark,
            hideLoginNameSuffix, disableWatermark, themeMode
          } + .
        | (if $primary       != "" then .primaryColor       = $primary       else . end)
        | (if $warn          != "" then .warnColor          = $warn          else . end)
        | (if $background    != "" then .backgroundColor    = $background    else . end)
        | (if $font          != "" then .fontColor          = $font          else . end)
        | (if $primaryDark   != "" then .primaryColorDark   = $primaryDark   else . end)
        | (if $warnDark      != "" then .warnColorDark      = $warnDark      else . end)
        | (if $backgroundDark != "" then .backgroundColorDark = $backgroundDark else . end)
        | (if $fontDark      != "" then .fontColorDark      = $fontDark      else . end)
        | (if $hideSuffix    == "true" then .hideLoginNameSuffix = true else . end)
        | (if $disableMark   == "true" then .disableWatermark    = true else . end)
        | (if $themeMode     != "" then .themeMode          = $themeMode    else . end)
        | with_entries(select(.value != null and .value != ""))')
    if [ "$label_scope" != "instance" ] && \
       ! echo "$current_label" | jq -e '.policy' >/dev/null 2>&1; then
        label_create_response=$(zitadel_api "POST" "$label_put_path" \
            "$label_body" "$TOKEN" "$ZITADEL_URL")
        if ! echo "$label_create_response" | jq -e '.details' >/dev/null 2>&1; then
            echo "WARNING: per-org label policy create failed" >&2
            echo "$label_create_response" >&2
        fi
        label_response="$label_create_response"
    else
        label_response=$(zitadel_api "PUT" "$label_put_path" \
            "$label_body" "$TOKEN" "$ZITADEL_URL")
    fi
    if echo "$label_response" | jq -e '.details' >/dev/null 2>&1 || \
       echo "$label_response" | is_zitadel_no_change; then
        upload_label_logo_at "$label_logo_path"      "${FM_BRAND_LOGO_PATH:-}"
        upload_label_logo_at "$label_logo_dark_path" "${FM_BRAND_LOGO_DARK_PATH:-}"
        upload_label_logo_at "$label_icon_path"      "${FM_BRAND_ICON_PATH:-}"
        upload_label_logo_at "$label_icon_dark_path" "${FM_BRAND_ICON_DARK_PATH:-}"
        upload_label_logo_at "$label_font_path"      "${FM_BRAND_FONT_PATH:-}"
        activate_response=$(zitadel_api "POST" "$label_activate_path" \
            "{}" "$TOKEN" "$ZITADEL_URL")
        if echo "$activate_response" | jq -e '.details' >/dev/null 2>&1 || \
           echo "$activate_response" | is_zitadel_no_change; then
            echo "  Label policy activated ($label_scope)"
        else
            echo "WARNING: label policy activate failed" >&2
            echo "$activate_response" >&2
        fi
    else
        echo "WARNING: label policy update failed — keeping previous values" >&2
        echo "$label_response" >&2
    fi
    unset ZITADEL_ORG_HEADER
}

configure_privacy_policy() {
    local privacy_path privacy_scope privacy_body privacy_response current_privacy

    if ! has_privacy_overrides; then
        echo "Skipping privacy policy (no FM_PRIVACY_* overrides)"
        return 0
    fi

    if [ -n "${CLIENT_ID:-}" ] && [ -n "${ORGANIZATION_ID:-}" ]; then
        privacy_path="/management/v1/policies/privacy"
        privacy_scope="org $ORGANIZATION_ID"
        export ZITADEL_ORG_HEADER="$ORGANIZATION_ID"
    else
        privacy_path="/admin/v1/policies/privacy"
        privacy_scope="instance"
        unset ZITADEL_ORG_HEADER
    fi
    echo "Configuring privacy policy ($privacy_scope)..."
    privacy_body=$(jq -cn \
        --arg tos          "${FM_PRIVACY_TOS_LINK:-}" \
        --arg priv         "${FM_PRIVACY_PRIVACY_LINK:-}" \
        --arg help         "${FM_PRIVACY_HELP_LINK:-}" \
        --arg supportEmail "${FM_PRIVACY_SUPPORT_EMAIL:-}" \
        --arg docs         "${FM_PRIVACY_DOCS_LINK:-}" \
        --arg custom       "${FM_PRIVACY_CUSTOM_LINK:-}" \
        --arg customText   "${FM_PRIVACY_CUSTOM_LINK_TEXT:-}" \
        '{}
        | (if $tos          != "" then .tosLink         = $tos          else . end)
        | (if $priv         != "" then .privacyLink     = $priv         else . end)
        | (if $help         != "" then .helpLink        = $help         else . end)
        | (if $supportEmail != "" then .supportEmail    = $supportEmail else . end)
        | (if $docs         != "" then .docsLink        = $docs         else . end)
        | (if $custom       != "" then .customLink      = $custom       else . end)
        | (if $customText   != "" then .customLinkText  = $customText   else . end)')
    if [ "$privacy_scope" = "instance" ]; then
        privacy_response=$(zitadel_api "PUT" "$privacy_path" \
            "$privacy_body" "$TOKEN" "$ZITADEL_URL")
    else
        current_privacy=$(zitadel_api "GET" "$privacy_path" "" "$TOKEN" "$ZITADEL_URL")
        if echo "$current_privacy" | jq -e '.policy' >/dev/null 2>&1; then
            privacy_response=$(zitadel_api "PUT" "$privacy_path" \
                "$privacy_body" "$TOKEN" "$ZITADEL_URL")
        else
            privacy_response=$(zitadel_api "POST" "$privacy_path" \
                "$privacy_body" "$TOKEN" "$ZITADEL_URL")
        fi
    fi
    if echo "$privacy_response" | jq -e '.details' >/dev/null 2>&1 || \
       echo "$privacy_response" | is_zitadel_no_change; then
        echo "  Privacy policy applied ($privacy_scope)"
    else
        echo "WARNING: privacy policy update failed" >&2
        echo "$privacy_response" >&2
    fi
    unset ZITADEL_ORG_HEADER
}

configure_login_force_mfa() {
    local desired="$1"
    local current body response
    current=$(zitadel_api "GET" "/admin/v1/policies/login" "" "$TOKEN" "$ZITADEL_URL")
    if ! echo "$current" | jq -e '.policy' >/dev/null 2>&1; then
        echo "  WARNING: cannot read default Login Policy — skipping forceMfa" >&2
        return 0
    fi
    body=$(echo "$current" | jq -c --argjson force "$desired" \
        '.policy
         | del(.details, .isDefault, .secondFactors, .multiFactors)
         | .forceMfa = $force')
    response=$(zitadel_api "PUT" "/admin/v1/policies/login" \
        "$body" "$TOKEN" "$ZITADEL_URL")
    if echo "$response" | jq -e '.details' >/dev/null 2>&1 || \
       echo "$response" | is_zitadel_no_change; then
        echo "  Login policy applied (forceMfa=$desired)"
    else
        echo "  WARNING: login policy update failed" >&2
        echo "$response" >&2
    fi
}

configure_login_policy_from_env() {
    case "${ZITADEL_FORCE_MFA:-}" in
        true|1)  configure_login_force_mfa true ;;
        false|0) configure_login_force_mfa false ;;
        "")      echo "Skipping login policy (ZITADEL_FORCE_MFA unset)" ;;
        *)       echo "  WARNING: ZITADEL_FORCE_MFA='$ZITADEL_FORCE_MFA' invalid — must be true|false" >&2 ;;
    esac
}

configure_instance_features_from_env() {
    local login_base_uri body response
    login_base_uri="${ZITADEL_PUBLIC_URL}/ui/v2/login/"

    body=$(jq -cn \
        --arg baseUri "$login_base_uri" \
        --argjson debugOidc "${ZITADEL_DEBUG_OIDC_PARENT_ERROR:-false}" \
        '{
            loginV2: {
                required: true,
                baseUri: $baseUri
            },
            debugOidcParentError: $debugOidc,
            oidcSingleV1SessionTermination: true,
            permissionCheckV2: true
        }')

    echo "Configuring instance features..."
    response=$(zitadel_api "PUT" "/v2/features/instance" \
        "$body" "$TOKEN" "$ZITADEL_URL")
    if echo "$response" | jq -e '.details' >/dev/null 2>&1 || \
       echo "$response" | is_zitadel_no_change; then
        echo "  Login V2 base URI: $login_base_uri"
    else
        echo "  WARNING: instance feature update failed" >&2
        echo "$response" >&2
    fi
}
