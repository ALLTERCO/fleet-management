# shellcheck shell=bash

register_internal_domains() {
    if [ -n "$SYSTEM_API_KEY_PATH" ] && [ -f "$SYSTEM_API_KEY_PATH" ]; then
        echo ""
        echo "--- Internal Domains ---"
        system_api_add_instance_domain "$ZITADEL_URL" "$SYSTEM_API_KEY_PATH" "$DOCKER_INTERNAL_HOST"
        # Legacy alias for tokens issued before the zitadel→zitadel-api rename.
        if [ "$DOCKER_INTERNAL_HOST" != "zitadel" ]; then
            system_api_add_instance_domain "$ZITADEL_URL" "$SYSTEM_API_KEY_PATH" "zitadel"
        fi
        system_api_add_instance_domain "$ZITADEL_URL" "$SYSTEM_API_KEY_PATH" "localhost"
    else
        echo ""
        echo "  Skipping internal domain registration (no System API key)"
    fi
}
