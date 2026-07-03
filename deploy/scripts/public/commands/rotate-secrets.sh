# shellcheck shell=bash
# rotate-secrets.sh — rotate the rotatable public-deploy secrets.
#
# Rotates:
#   JWT_SECRET              — invalidates active FM sessions, new tokens use new key
#   FM_SECRET_ENCRYPTION_KEY — re-encrypts FM at-rest secrets (BTHome auth, MQTT creds, etc.)
#   POSTGRES_PASSWORD       — ALTER USER + restart
#
# DOES NOT rotate ZITADEL_MASTERKEY — Zitadel has no online masterkey-rotation
# operation. The masterkey decrypts a per-instance encryption seed stored in
# the DB; changing it requires re-bootstrapping Zitadel from scratch, which
# loses all org / user / app data. If you must rotate it, do a full backup
# (rotate-secrets backup), `down --volumes`, then `up` with the new key set.
#
# Procedure:
#   1. snapshot deploy/state/ (timestamped)
#   2. stop fleet-manager (FM holds JWT + encryption key in memory)
#   3. rewrite state/.env with new values
#   4. start fleet-manager — boot path re-encrypts any at-rest blobs with the new key

cmd_rotate_secrets() {
    enable_debug_mode
    # Restores DEPLOY_ENV + FM_DEV_MODE from saved state so compose_cmd picks
    # the matching compose file set when restarting fleet-manager.
    load_deploy_meta

    local rotate_jwt=false
    local rotate_fm_enc=false
    local rotate_pg=false
    local graceful=false
    local clear_graceful=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --jwt)               rotate_jwt=true ;;
            --fm-enc)            rotate_fm_enc=true ;;
            --postgres)          rotate_pg=true ;;
            --all)               rotate_jwt=true; rotate_fm_enc=true; rotate_pg=true ;;
            --graceful)          graceful=true ;;
            --clear-graceful)    clear_graceful=true ;;
            --help|-h)           _rotate_secrets_help; return 0 ;;
            *)                   error "Unknown flag: $1"; _rotate_secrets_help; return 1 ;;
        esac
        shift
    done

    if [ "$graceful" = true ] && [ "$rotate_jwt" = false ]; then
        error "--graceful only applies to --jwt"
        return 1
    fi
    if [ "$graceful" = true ] && [ "$clear_graceful" = true ]; then
        error "--graceful and --clear-graceful are mutually exclusive"
        return 1
    fi

    if [ "$rotate_jwt" = false ] && [ "$rotate_fm_enc" = false ] && [ "$rotate_pg" = false ] && [ "$clear_graceful" = false ]; then
        _rotate_secrets_help
        return 1
    fi

    if [ ! -f "$STATE_DIR/.env" ]; then
        error "No deploy/state/.env — nothing to rotate. Run 'install' first."
        return 1
    fi

    phase "Phase 1/4 — Backup state"
    local stamp
    stamp=$(date +%Y%m%d-%H%M%S)
    local backup="$STATE_DIR/backups/state-$stamp.env"
    mkdir -p "$STATE_DIR/backups"
    chmod 0700 "$STATE_DIR/backups"
    cp "$STATE_DIR/.env" "$backup"
    chmod 0600 "$backup"
    ok "State backed up to $(_color_path "$backup")"

    # shellcheck source=/dev/null
    source "$STATE_DIR/.env"

    phase "Phase 2/4 — Generate new values"
    local new_jwt="" new_fm_enc="" new_pg=""
    local new_kid_current="" new_kid_previous="" new_secret_previous=""
    if [ "$rotate_jwt" = true ]; then
        # Refuse to overwrite a populated previous slot — running --graceful
        # twice in a row would clobber the ORIGINAL old secret, orphaning
        # any token still signed under it. Operator must --clear-graceful
        # first, or wait for the window to close naturally.
        if [ "$graceful" = true ] && [ -n "${FM_JWT_SECRET_PREVIOUS:-}" ]; then
            error "FM_JWT_SECRET_PREVIOUS is already populated — a graceful rotation is already in progress."
            error "Run 'rotate-secrets --clear-graceful' to close it, then retry."
            return 1
        fi
        new_jwt=$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)
        info "New JWT_SECRET generated"
        if [ "$graceful" = true ]; then
            # Move OLD secret + kid into the previous slot; mint a fresh
            # timestamped kid for the new secret. Tokens signed under the
            # old kid keep verifying until --clear-graceful is run.
            new_secret_previous="${JWT_SECRET}"
            new_kid_previous="${FM_JWT_KID_CURRENT:-primary}"
            new_kid_current="rotated-$stamp"
            info "Graceful rotation: previous slot will hold old kid '$new_kid_previous'; new kid '$new_kid_current'"
        fi
    fi
    if [ "$rotate_fm_enc" = true ]; then
        new_fm_enc=$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)
        info "New FM_SECRET_ENCRYPTION_KEY generated"
    fi
    if [ "$rotate_pg" = true ]; then
        new_pg=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
        info "New POSTGRES_PASSWORD generated"
    fi
    if [ "$clear_graceful" = true ]; then
        info "Clearing graceful rotation slot (FM_JWT_SECRET_PREVIOUS, FM_JWT_KID_PREVIOUS)"
    fi

    phase "Phase 3/4 — Apply"
    if [ "$rotate_pg" = true ]; then
        step "Updating Postgres role password (in-place)"
        if ! _rotate_pg_password "$new_pg"; then
            error "Postgres password rotation failed — original .env untouched"
            return 1
        fi
        ok "Postgres role updated"
    fi

    step "Rewriting state/.env"
    local tmp="$STATE_DIR/.env.new"
    # Resolve the four JWT slots before the heredoc — keeps the template
    # readable and the precedence explicit.
    #
    # JWT_SECRET:             new (if rotating) | existing
    # FM_JWT_KID_CURRENT:     graceful timestamp | existing | unset
    # FM_JWT_SECRET_PREVIOUS: old secret (graceful) | "" (clear) | existing
    # FM_JWT_KID_PREVIOUS:    old kid (graceful)    | "" (clear) | existing
    local out_jwt="${new_jwt:-$JWT_SECRET}"
    local out_kid_current="${new_kid_current:-${FM_JWT_KID_CURRENT:-}}"
    local out_secret_previous out_kid_previous
    if [ "$clear_graceful" = true ]; then
        out_secret_previous=""
        out_kid_previous=""
    elif [ "$graceful" = true ]; then
        out_secret_previous="$new_secret_previous"
        out_kid_previous="$new_kid_previous"
    else
        out_secret_previous="${FM_JWT_SECRET_PREVIOUS:-}"
        out_kid_previous="${FM_JWT_KID_PREVIOUS:-}"
    fi
    # ZITADEL_POSTGRES_PASSWORD / ZITADEL_DB_USER_PASSWORD live in the
    # separate zitadel-db container — rotating them requires ALTER USER
    # there too (out of scope for this script). Keep their values intact.
    cat > "$tmp" <<EOF
# Auto-generated by deploy-public.sh — do not edit
# Last rotated: $stamp
POSTGRES_PASSWORD=${new_pg:-$POSTGRES_PASSWORD}
ZITADEL_POSTGRES_PASSWORD=${ZITADEL_POSTGRES_PASSWORD}
ZITADEL_DB_USER_PASSWORD=${ZITADEL_DB_USER_PASSWORD}
ZITADEL_ADMIN_PASSWORD=${ZITADEL_ADMIN_PASSWORD}
ZITADEL_MASTERKEY=${ZITADEL_MASTERKEY}
FM_SECRET_ENCRYPTION_KEY=${new_fm_enc:-$FM_SECRET_ENCRYPTION_KEY}
FM_SECRET_KDF_SALT=${FM_SECRET_KDF_SALT}
JWT_SECRET=${out_jwt}
FM_JWT_KID_CURRENT=${out_kid_current}
FM_JWT_SECRET_PREVIOUS=${out_secret_previous}
FM_JWT_KID_PREVIOUS=${out_kid_previous}
FM_ADMIN_PASSWORD=${FM_ADMIN_PASSWORD}
FM_PLATFORM_ADMIN_PASSWORD=${FM_PLATFORM_ADMIN_PASSWORD}
EOF
    chmod 0600 "$tmp"
    mv "$tmp" "$STATE_DIR/.env"
    ok "state/.env rewritten"

    phase "Phase 4/4 — Restart fleet-manager"
    if run_quiet "Restarting fleet-manager" compose_cmd up -d fleet-manager; then
        ok "fleet-manager restarted with new secrets"
    else
        error "Restart failed — restore from $backup if needed"
        return 1
    fi

    echo ""
    info "Rotation complete. Backup: $(_color_path "$backup")"
    if [ "$rotate_jwt" = true ] && [ "$graceful" = false ]; then
        warn "Forced JWT rotation: tokens signed under the old key (FM PATs, Alexa link tokens) are now invalid"
    fi
    if [ "$graceful" = true ]; then
        info "Graceful slot in effect. Run 'rotate-secrets --clear-graceful' once all old PATs have rotated or expired."
    fi
    if [ "$clear_graceful" = true ]; then
        warn "Graceful slot cleared: any token still presented under the old kid will now be rejected"
    fi
}

_rotate_secrets_help() {
    cat <<'EOF'
Usage: deploy-public.sh rotate-secrets [flags]

  --jwt              Rotate JWT_SECRET. Without --graceful: forced rotation
                     (tokens signed under the old key stop verifying on restart).
  --graceful         Modifier for --jwt. Keeps the OLD secret alive in the
                     previous-kid slot so tokens minted before rotation
                     continue to verify until --clear-graceful is run.
                     Required for compliance-driven rotations where breaking
                     every active PAT / Alexa link is unacceptable.
  --clear-graceful   Empty FM_JWT_SECRET_PREVIOUS + FM_JWT_KID_PREVIOUS.
                     Run after every old-kid token has rotated or expired
                     to close the rotation window.
  --fm-enc           Rotate FM_SECRET_ENCRYPTION_KEY (re-encrypts FM
                     at-rest secrets; FM restart).
  --postgres         Rotate POSTGRES_PASSWORD (ALTER USER on fleet-db;
                     FM restart drops live queries).
  --all              --jwt + --fm-enc + --postgres. Disruptive.

State/.env is backed up to state/backups/state-<timestamp>.env (chmod 0600) before any change.

Note: ZITADEL_MASTERKEY cannot be rotated online. See script header.
EOF
}

# ALTER USER role inside fleet-db. Idempotent + scoped to the postgres user
# that both FM and Zitadel-DB share. Runs against the live container.
_rotate_pg_password() {
    local new_pw="$1"
    local container
    container=$(container_name fleet-db)
    if ! docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
        error "fleet-db not reachable inside container '$container'"
        return 1
    fi
    docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$container" \
        psql -U postgres -d postgres -v new_password="$new_pw" -c \
        "ALTER USER postgres WITH PASSWORD :'new_password';" >/dev/null
}

# Tiny inline colorizer for paths in summary output. Keeps the rotation
# command self-contained; falls back to plain text if no TTY.
_color_path() {
    if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
        printf '\033[36m%s\033[0m' "$1"
    else
        printf '%s' "$1"
    fi
}
