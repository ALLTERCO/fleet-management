# shellcheck shell=bash
# state/env.sh — persisted public deploy environment state.

load_state_env() {
    if [ -f "$STATE_DIR/.env" ]; then
        # shellcheck source=/dev/null
        source "$STATE_DIR/.env"
        export POSTGRES_PASSWORD ZITADEL_POSTGRES_PASSWORD ZITADEL_DB_USER_PASSWORD
        export ZITADEL_ADMIN_PASSWORD ZITADEL_MASTERKEY
        export FM_SECRET_ENCRYPTION_KEY FM_SECRET_KDF_SALT
        export FM_SECRET_ENCRYPTION_KEY_ID FM_SECRET_ENCRYPTION_KEY_PREVIOUS
        export FM_SECRET_ENCRYPTION_KEY_PREVIOUS_ID
        export FM_DEVICE_INGRESS_TOKEN_PEPPER FM_NOTIFICATION_RECEIPT_SIGNING_SECRET
        export JWT_SECRET
        export FM_JWT_KID_CURRENT FM_JWT_SECRET_PREVIOUS FM_JWT_KID_PREVIOUS
        export FM_ADMIN_PASSWORD FM_PLATFORM_ADMIN_PASSWORD
        export REDIS_ADMIN_PASSWORD REDIS_FM_PASSWORD REDIS_ZITADEL_PASSWORD
    fi
}

save_env() {
    local env_file="$STATE_DIR/.env"
    mkdir -p "$STATE_DIR"

    if [ -f "$env_file" ]; then
        # shellcheck source=/dev/null
        source "$env_file"
        export POSTGRES_PASSWORD ZITADEL_POSTGRES_PASSWORD ZITADEL_DB_USER_PASSWORD
        export ZITADEL_ADMIN_PASSWORD ZITADEL_MASTERKEY
        export FM_SECRET_ENCRYPTION_KEY FM_SECRET_KDF_SALT
        export FM_SECRET_ENCRYPTION_KEY_ID FM_SECRET_ENCRYPTION_KEY_PREVIOUS
        export FM_SECRET_ENCRYPTION_KEY_PREVIOUS_ID
        export FM_DEVICE_INGRESS_TOKEN_PEPPER FM_NOTIFICATION_RECEIPT_SIGNING_SECRET
        export JWT_SECRET
        export FM_JWT_KID_CURRENT FM_JWT_SECRET_PREVIOUS FM_JWT_KID_PREVIOUS
        export FM_ADMIN_PASSWORD FM_PLATFORM_ADMIN_PASSWORD

        # Persist any secret the prior file lacked. Catches both legacy
        # installs predating a given key and partial-vault hydration paths
        # where load-secrets.sh resolved only a subset of keys.
        local backfilled=()
        local backfill_lines=()
        _backfill_random() {
            local name="$1" bytes="${2:-48}"
            if [ -z "$(_state_env_value "$name")" ]; then
                local val="${!name:-}"
                [ -n "$val" ] || val=$(_random_passwd "$bytes")
                printf -v "$name" '%s' "$val"
                export "${name?}"
                backfill_lines+=("${name}=${val}")
                backfilled+=("$name")
            fi
        }
        _backfill_alias() {
            local name="$1" source_name="$2"
            if [ -z "${!name:-}" ]; then
                printf -v "$name" '%s' "${!source_name}"
                export "${name?}"
                backfill_lines+=("${name}=${!name}")
                backfilled+=("$name")
            fi
        }
        _state_env_value() {
            local name="$1"
            sed -n "s/^${name}=//p" "$env_file" | tail -1
        }
        _acl_password_value() {
            local user="$1" aclfile="$STATE_DIR/redis-users.acl"
            [ -f "$aclfile" ] || return 0
            awk -v user="$user" '
                $1 == "user" && $2 == user {
                    for (i = 1; i <= NF; i++) {
                        if (substr($i, 1, 1) == ">") {
                            print substr($i, 2)
                            exit
                        }
                    }
                }
            ' "$aclfile"
        }
        _backfill_redis_password() {
            local name="$1" user="$2"
            if [ -n "$(_state_env_value "$name")" ]; then
                export "${name?}"
                return 0
            fi
            local acl_value
            acl_value="$(_acl_password_value "$user")"
            if [ -n "$acl_value" ]; then
                printf -v "$name" '%s' "$acl_value"
            elif [ -z "${!name:-}" ]; then
                printf -v "$name" '%s' "$(_random_passwd 32)"
            fi
            export "${name?}"
            backfill_lines+=("${name}=${!name}")
            backfilled+=("$name")
        }
        _backfill_random POSTGRES_PASSWORD 24
        # Zitadel-DB / role passwords default to POSTGRES_PASSWORD when
        # missing (matches first-install behavior in state/secrets.sh).
        _backfill_alias ZITADEL_POSTGRES_PASSWORD POSTGRES_PASSWORD
        _backfill_alias ZITADEL_DB_USER_PASSWORD POSTGRES_PASSWORD
        if [ -z "${ZITADEL_ADMIN_PASSWORD:-}" ]; then
            ZITADEL_ADMIN_PASSWORD="$(_random_zitadel_admin)"
            export ZITADEL_ADMIN_PASSWORD
            backfill_lines+=("ZITADEL_ADMIN_PASSWORD=${ZITADEL_ADMIN_PASSWORD}")
            backfilled+=("ZITADEL_ADMIN_PASSWORD")
        fi
        _backfill_random ZITADEL_MASTERKEY 32
        local state_fm_secret state_jwt_secret state_fm_key_id
        state_fm_secret="$(_state_env_value FM_SECRET_ENCRYPTION_KEY)"
        state_jwt_secret="$(_state_env_value JWT_SECRET)"
        state_fm_key_id="$(_state_env_value FM_SECRET_ENCRYPTION_KEY_ID)"
        if [ -z "$state_fm_secret" ] && [ -n "$state_jwt_secret" ]; then
            migrate_legacy_secret_encryption_key \
                "$state_jwt_secret" "${state_fm_key_id:-primary}" || return 1
            backfill_lines+=("FM_SECRET_ENCRYPTION_KEY=${FM_SECRET_ENCRYPTION_KEY}")
            backfill_lines+=("FM_SECRET_ENCRYPTION_KEY_ID=${FM_SECRET_ENCRYPTION_KEY_ID}")
            backfill_lines+=("FM_SECRET_ENCRYPTION_KEY_PREVIOUS=${FM_SECRET_ENCRYPTION_KEY_PREVIOUS}")
            backfill_lines+=("FM_SECRET_ENCRYPTION_KEY_PREVIOUS_ID=${FM_SECRET_ENCRYPTION_KEY_PREVIOUS_ID}")
            backfilled+=("FM_SECRET_ENCRYPTION_KEY" "FM_SECRET_ENCRYPTION_KEY_PREVIOUS")
        elif [ -z "${FM_SECRET_ENCRYPTION_KEY:-}" ]; then
            _backfill_random FM_SECRET_ENCRYPTION_KEY 64
        fi
        _backfill_random FM_SECRET_KDF_SALT 32
        _backfill_random FM_DEVICE_INGRESS_TOKEN_PEPPER 64
        _backfill_random FM_NOTIFICATION_RECEIPT_SIGNING_SECRET 64
        _backfill_random JWT_SECRET 64
        if [ -z "${FM_ADMIN_PASSWORD:-}" ]; then
            FM_ADMIN_PASSWORD="$(_random_zitadel_admin)"
            export FM_ADMIN_PASSWORD
            backfill_lines+=("FM_ADMIN_PASSWORD=${FM_ADMIN_PASSWORD}")
            backfilled+=("FM_ADMIN_PASSWORD")
        fi
        if [ -z "${FM_PLATFORM_ADMIN_PASSWORD:-}" ]; then
            FM_PLATFORM_ADMIN_PASSWORD="$(_random_zitadel_admin)"
            export FM_PLATFORM_ADMIN_PASSWORD
            backfill_lines+=("FM_PLATFORM_ADMIN_PASSWORD=${FM_PLATFORM_ADMIN_PASSWORD}")
            backfilled+=("FM_PLATFORM_ADMIN_PASSWORD")
        fi
        _backfill_redis_password REDIS_ADMIN_PASSWORD fm-admin
        _backfill_redis_password REDIS_FM_PASSWORD fm-default
        _backfill_redis_password REDIS_ZITADEL_PASSWORD zitadel
        if [ "${#backfilled[@]}" -gt 0 ]; then
            local tmp
            tmp="$(mktemp "${env_file}.XXXXXX")" || return 1
            cat "$env_file" > "$tmp"
            printf '%s\n' "${backfill_lines[@]}" >> "$tmp"
            chmod 0600 "$tmp"
            mv "$tmp" "$env_file"
            info "Backfilled ${backfilled[*]} (missing from prior install)"
        else
            info "Loaded existing configuration"
        fi
    else
        local tmp
        tmp="$(mktemp "${env_file}.XXXXXX")" || return 1
        cat > "$tmp" <<EOF
# Auto-generated by deploy-public.sh — do not edit
# Delete this file + volumes to reset: ./deploy/deploy-public.sh down --volumes
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
ZITADEL_POSTGRES_PASSWORD=${ZITADEL_POSTGRES_PASSWORD}
ZITADEL_DB_USER_PASSWORD=${ZITADEL_DB_USER_PASSWORD}
ZITADEL_ADMIN_PASSWORD=${ZITADEL_ADMIN_PASSWORD}
ZITADEL_MASTERKEY=${ZITADEL_MASTERKEY}
FM_SECRET_ENCRYPTION_KEY=${FM_SECRET_ENCRYPTION_KEY}
FM_SECRET_KDF_SALT=${FM_SECRET_KDF_SALT}
FM_SECRET_ENCRYPTION_KEY_ID=${FM_SECRET_ENCRYPTION_KEY_ID:-primary}
FM_SECRET_ENCRYPTION_KEY_PREVIOUS=${FM_SECRET_ENCRYPTION_KEY_PREVIOUS:-}
FM_SECRET_ENCRYPTION_KEY_PREVIOUS_ID=${FM_SECRET_ENCRYPTION_KEY_PREVIOUS_ID:-previous}
FM_DEVICE_INGRESS_TOKEN_PEPPER=${FM_DEVICE_INGRESS_TOKEN_PEPPER}
FM_NOTIFICATION_RECEIPT_SIGNING_SECRET=${FM_NOTIFICATION_RECEIPT_SIGNING_SECRET}
JWT_SECRET=${JWT_SECRET}
FM_JWT_KID_CURRENT=${FM_JWT_KID_CURRENT:-}
FM_JWT_SECRET_PREVIOUS=${FM_JWT_SECRET_PREVIOUS:-}
FM_JWT_KID_PREVIOUS=${FM_JWT_KID_PREVIOUS:-}
FM_ADMIN_PASSWORD=${FM_ADMIN_PASSWORD}
FM_PLATFORM_ADMIN_PASSWORD=${FM_PLATFORM_ADMIN_PASSWORD}
REDIS_ADMIN_PASSWORD=${REDIS_ADMIN_PASSWORD}
REDIS_FM_PASSWORD=${REDIS_FM_PASSWORD}
REDIS_ZITADEL_PASSWORD=${REDIS_ZITADEL_PASSWORD}
EOF
        chmod 0600 "$tmp"
        mv "$tmp" "$env_file"
        info "Generated new configuration"
        write_initial_credentials_file "$STATE_DIR"
    fi
}

# Human-readable companion to state/.env. Written once on first install.
write_initial_credentials_file() {
    local state_dir="$1"
    local creds_file="$state_dir/initial-credentials.txt"
    cat > "$creds_file" <<EOF
Fleet Manager — initial credentials (auto-generated)
=====================================================

These values were created on first install by deploy-public.sh and
persisted to $state_dir/.env (chmod 0600). Save them to your password
manager now.

Zitadel Root
  Username: root@<your-host>
  Password: ${ZITADEL_ADMIN_PASSWORD}

Fleet Manager Admin
  Username: ${FM_ADMIN_USER:-fm-admin}@<your-host>
  Password: ${FM_ADMIN_PASSWORD}

Fleet Manager Platform Admin
  Username: ${FM_PLATFORM_ADMIN_USER:-fm-platform-admin}@<your-host>
  Password: ${FM_PLATFORM_ADMIN_PASSWORD}

Database (TimescaleDB)
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}

Server-side internals (rotate via deploy-public.sh rotate-secrets)
  ZITADEL_MASTERKEY:        ${ZITADEL_MASTERKEY}
  FM_SECRET_ENCRYPTION_KEY: ${FM_SECRET_ENCRYPTION_KEY}
  FM_SECRET_KDF_SALT:       ${FM_SECRET_KDF_SALT}
  FM_DEVICE_INGRESS_TOKEN_PEPPER: ${FM_DEVICE_INGRESS_TOKEN_PEPPER}
  JWT_SECRET:               ${JWT_SECRET}

Retrieve again later:
  ./deploy/deploy-public.sh status
  cat ${creds_file}

Rotate:
  ./deploy/deploy-public.sh rotate-secrets
EOF
    chmod 0600 "$creds_file"
}
