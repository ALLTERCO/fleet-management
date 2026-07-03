# shellcheck shell=bash
# backup-state.sh — encrypted tarball of deploy/state/ for off-host transport.
#
# state/ contains:
#   .env                          chmod 0600 — all credentials
#   machinekey/zitadel-admin-sa.json — Zitadel service-account private key
#   system-api/system-user.pem    — RSA private key
#   secrets/*.json                — Zitadel app-key JSON (jwt-profile auth)
#   letsencrypt/acme.json         — TLS account + certs
#
# Plain tar of this directory is a credential dump. This wrapper:
#   1. tars state/ excluding ephemeral subdirs
#   2. encrypts with age (if available) or openssl aes-256-cbc (fallback)
#   3. writes to ./backups/state-<hostname>-<stamp>.tar.{age,enc}
#
# Decrypt with:
#   age:     age -d -i key.txt < backup.tar.age | tar -xz
#   openssl: openssl enc -d -aes-256-cbc -pbkdf2 -in backup.tar.enc | tar -xz

cmd_backup_state() {
    enable_debug_mode

    local recipient=""        # age public key file or --passphrase
    local out_dir="./backups"
    local use_passphrase=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --age-recipient) recipient="$2"; shift 2 ;;
            --passphrase)    use_passphrase=true; shift ;;
            --out)           out_dir="$2"; shift 2 ;;
            --help|-h)       _backup_state_help; return 0 ;;
            *)               error "Unknown flag: $1"; _backup_state_help; return 1 ;;
        esac
    done

    if [ ! -d "$STATE_DIR" ]; then
        error "No deploy/state/ — nothing to back up. Run 'install' first."
        return 1
    fi
    if [ "$use_passphrase" = false ] && [ -z "$recipient" ]; then
        error "Must specify either --age-recipient <pubkey-file> or --passphrase"
        _backup_state_help
        return 1
    fi

    mkdir -p "$out_dir"
    local stamp host
    stamp=$(date +%Y%m%d-%H%M%S)
    host=$(hostname -s 2>/dev/null || echo unknown)

    # Tar the cred-bearing files only. Exclude ephemeral subdirs (backups/
    # within state, log fragments, lock files). Path-anchored exclude so
    # any nested `backups/` elsewhere wouldn't get pruned by accident.
    local state_base
    state_base=$(basename "$STATE_DIR")
    local tar_args=(
        --exclude="${state_base}/backups"
        --exclude='*.log'
        --exclude='*.lock'
    )

    if [ "$use_passphrase" = true ]; then
        if ! command -v openssl >/dev/null 2>&1; then
            error "openssl not found — required for --passphrase mode"
            return 1
        fi
        local out="$out_dir/state-$host-$stamp.tar.enc"
        # BACKUP_PASSPHRASE env var path so CI / cron / non-TTY runs work.
        # Otherwise openssl prompts on /dev/tty — fine for interactive use.
        local -a pass_args=()
        if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
            pass_args=(-pass env:BACKUP_PASSPHRASE)
            info "Encrypting state/ with BACKUP_PASSPHRASE (AES-256-CBC + PBKDF2)"
        else
            info "Encrypting state/ with passphrase (AES-256-CBC + PBKDF2)"
        fi
        if tar -czf - "${tar_args[@]}" -C "$(dirname "$STATE_DIR")" "$(basename "$STATE_DIR")" \
            | openssl enc -aes-256-cbc -pbkdf2 -salt "${pass_args[@]}" -out "$out"; then
            chmod 0600 "$out"
            ok "Encrypted backup: $out"
            _print_decrypt_hint openssl "$out"
        else
            error "Encryption failed"
            return 1
        fi
    else
        if ! command -v age >/dev/null 2>&1; then
            error "age not found — install with 'brew install age' or apt/dnf"
            return 1
        fi
        if [ ! -f "$recipient" ]; then
            error "Recipient file not found: $recipient"
            return 1
        fi
        local out="$out_dir/state-$host-$stamp.tar.age"
        info "Encrypting state/ with age (recipient: $recipient)"
        if tar -czf - "${tar_args[@]}" -C "$(dirname "$STATE_DIR")" "$(basename "$STATE_DIR")" \
            | age -R "$recipient" -o "$out"; then
            chmod 0600 "$out"
            ok "Encrypted backup: $out"
            _print_decrypt_hint age "$out"
        else
            error "Encryption failed"
            return 1
        fi
    fi
}

_backup_state_help() {
    cat <<'EOF'
Usage: deploy-public.sh backup-state (--age-recipient FILE | --passphrase) [--out DIR]

  --age-recipient FILE   Encrypt to an age public key (recommended; non-interactive)
  --passphrase           Encrypt with a passphrase. Interactive by default;
                         set BACKUP_PASSPHRASE env var for non-interactive (CI/cron).
  --out DIR              Output directory (default: ./backups)

Examples:
  # Generate recipient once:  age-keygen -o key.txt; cat key.txt # has pubkey
  deploy-public.sh backup-state --age-recipient ./pubkey.txt
  deploy-public.sh backup-state --passphrase
  BACKUP_PASSPHRASE='...' deploy-public.sh backup-state --passphrase
EOF
}

_print_decrypt_hint() {
    local mode="$1" path="$2"
    info "Decrypt:"
    if [ "$mode" = "age" ]; then
        echo "  age -d -i key.txt < $path | tar -xz"
    else
        echo "  openssl enc -d -aes-256-cbc -pbkdf2 -in $path | tar -xz"
    fi
}
