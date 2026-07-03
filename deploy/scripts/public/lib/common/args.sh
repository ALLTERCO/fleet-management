# shellcheck shell=bash
# common/args.sh — public deploy CLI flag parsing.
# shellcheck disable=SC2034 # Parsed flag globals are consumed after this file is sourced.

parse_runtime_flags() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --debug)
                DEBUG_MODE=true
                shift ;;
            --mdns)
                WITH_MDNS=true
                shift ;;
            --logging)
                WITH_LOGGING=true
                shift ;;
            --with)
                error "Unknown flag: --with"
                error "Use --mdns for mDNS device discovery"
                return 1 ;;
            --ssl)
                WITH_SSL=true
                case "${2:-}" in
                    selfsigned|self-signed)
                        SSL_MODE="selfsigned"
                        shift 2
                        ;;
                    letsencrypt)
                        SSL_MODE="letsencrypt"
                        shift 2
                        ;;
                    custom)
                        SSL_MODE="custom"
                        shift 2
                        ;;
                    *)
                        SSL_MODE="letsencrypt"
                        shift
                        ;;
                esac
                ;;
            --domain)
                [ $# -ge 2 ] || {
                    error "--domain requires a value"
                    return 1
                }
                SSL_DOMAIN="${2:-}"
                shift 2 ;;
            --email)
                [ $# -ge 2 ] || {
                    error "--email requires a value"
                    return 1
                }
                SSL_EMAIL="${2:-}"
                shift 2 ;;
            --cert)
                [ $# -ge 2 ] || {
                    error "--cert requires a file path"
                    return 1
                }
                SSL_CERT_FILE="${2:-}"
                shift 2 ;;
            --key)
                [ $# -ge 2 ] || {
                    error "--key requires a file path"
                    return 1
                }
                SSL_KEY_FILE="${2:-}"
                shift 2 ;;
            --env)
                [ $# -ge 2 ] || {
                    error "--env requires a name (dev|local|public|cloud-test)"
                    return 1
                }
                DEPLOY_ENV="${2:-}"
                shift 2 ;;
            *)
                error "Unknown flag: $1"
                return 1
                ;;
        esac
    done

    # Default env is public (community installer happy path).
    DEPLOY_ENV="${DEPLOY_ENV:-public}"

    # Validate env name maps to an env file.
    case "$DEPLOY_ENV" in
        dev|local|public|cloud-test) ;;
        *)
            error "--env must be one of: dev, local, public, cloud-test (got: $DEPLOY_ENV)"
            return 1
            ;;
    esac

    # Dev env = local auth, no Zitadel, no SSL/domain.
    if [ "$DEPLOY_ENV" = "dev" ]; then
        if [ "$WITH_SSL" = "true" ]; then
            error "--env dev is incompatible with --ssl (local auth, HTTP only)"
            return 1
        fi
        if [ -n "${SSL_DOMAIN:-}" ]; then
            error "--env dev is incompatible with --domain (local auth, no public hostname)"
            return 1
        fi
    fi

    # Note: env-file loading is the caller's responsibility. `up.sh` calls
    # load_deploy_env_overrides directly; `down/status/etc` get it via
    # load_deploy_meta. Separating concerns avoids double-loads.
}

parse_global_flags() {
    PARSED_GLOBAL_ARGS=()

    while [ $# -gt 0 ]; do
        case "$1" in
            --debug)
                DEBUG_MODE=true
                ;;
            *)
                PARSED_GLOBAL_ARGS+=("$1")
                ;;
        esac
        shift
    done
}
