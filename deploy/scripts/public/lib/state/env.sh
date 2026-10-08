# shellcheck shell=bash
# state/env.sh — persisted public deploy environment state.
# shellcheck source=deploy/scripts/common/checksum.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../common" && pwd)/checksum.sh"

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
        export ZITADEL_SESSION_COOKIE_SECRET
    fi
}

public_kdf_salt_preflight() {
    local container
    container="$(container_name fleet-manager)"
    if docker inspect "$container" >/dev/null 2>&1; then
        # The container is the evidence again, so an older fingerprint must not outlive it.
        rm -f "$(public_kdf_salt_fingerprint_file)"
    elif _public_kdf_salt_matches_down_fingerprint; then
        info "KDF salt matches the value verified when 'down' removed Fleet Manager"
        return 0
    fi
    kdf_salt_preflight \
        "Public Fleet Manager deployment" \
        "$STATE_DIR/.env" \
        "$container" \
        "$STATE_DIR/deploy-meta.env"
}

# SHA-256 of the salt a clean `down` verified against its running container.
# Never the salt itself; only `down` writes it, any salt check with a
# container removes it, and every command that creates the container runs
# that check at once (public_kdf_salt_confirm_container).
public_kdf_salt_fingerprint_file() {
    printf '%s/kdf-salt-verified.sha256' "$STATE_DIR"
}

# Called by `down` before it removes the container that proves the salt. A
# container that is already gone leaves any earlier fingerprint as it was.
public_kdf_salt_record_before_down() {
    local container fingerprint_file tmp
    container="$(container_name fleet-manager)"
    docker inspect "$container" >/dev/null 2>&1 || return 0
    public_kdf_salt_preflight || return 1
    fingerprint_file="$(public_kdf_salt_fingerprint_file)"
    tmp="$(mktemp "${fingerprint_file}.XXXXXX")" || return 1
    chmod 0600 "$tmp"
    if ! printf '%s' "$FM_SECRET_KDF_SALT" | sha256_stream >"$tmp"; then
        rm -f "$tmp"
        return 1
    fi
    mv "$tmp" "$fingerprint_file"
}

# Called right after a command creates Fleet Manager. The new container is the
# salt evidence from now on, so the salt check verifies it and spends the
# fingerprint; a later failure cannot leave a fingerprint behind for a
# container someone removes by hand.
public_kdf_salt_confirm_container() {
    if ! docker inspect "$(container_name fleet-manager)" >/dev/null 2>&1; then
        error "Fleet Manager container is missing after start; its KDF salt cannot be verified"
        return 1
    fi
    public_kdf_salt_preflight
}

_public_kdf_salt_matches_down_fingerprint() {
    local fingerprint_file persisted recorded=""
    fingerprint_file="$(public_kdf_salt_fingerprint_file)"
    [ -f "$fingerprint_file" ] || return 1
    persisted="$(kdf_salt_from_env_file "$STATE_DIR/.env")"
    if [ -z "$persisted" ] || [ "${FM_SECRET_KDF_SALT:-}" != "$persisted" ]; then
        return 1
    fi
    read -r recorded <"$fingerprint_file" || true
    [ -n "$recorded" ] && [ "$(printf '%s' "$persisted" | sha256_stream)" = "$recorded" ]
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
        export ZITADEL_SESSION_COOKIE_SECRET

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
        # Persisted once: a new value signs every user out of the Zitadel login.
        _backfill_random ZITADEL_SESSION_COOKIE_SECRET 64
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
ZITADEL_SESSION_COOKIE_SECRET=${ZITADEL_SESSION_COOKIE_SECRET}
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

# Docker creates a missing bind-mount folder as root. The public installer
# takes such folders back with the same sudo it uses to install Docker; if
# that is not possible, ensure_state_bind_dirs stops and prints the fix.
public_ensure_state_dirs() {
    local blocked
    local -a dirs=()
    blocked="$(state_dirs_not_writable "$STATE_DIR" "${STATE_BIND_DIRS[@]}")"
    if [ -n "$blocked" ]; then
        mapfile -t dirs <<<"$blocked"
        info "Docker created ${#dirs[@]} state folder(s) as root; changing their owner back to you (sudo may ask for your password)"
        run_privileged chown "$(id -u):$(id -g)" "${dirs[@]}" \
            || warn "Could not change the owner of the state folders"
    fi
    ensure_state_bind_dirs "$STATE_DIR" "${STATE_BIND_DIRS[@]}"
}
