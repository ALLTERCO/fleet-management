#!/usr/bin/env bash
#
# Generate RSA keypair and config for Zitadel System API
#
# This enables the bootstrap script to add custom instance domains,
# allowing Docker-internal container-to-container communication.
#
# Idempotent: only generates if keypair doesn't already exist.
#
# Output:
#   deploy/state/system-api/system-user.pem      — RSA private key
#   deploy/state/system-api/system-user.pub       — RSA public key
#   deploy/state/system-api/system-api-config.yaml — Zitadel config override
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=deploy/scripts/common/zitadel-system-api-config.sh
source "$SCRIPT_DIR/zitadel-system-api-config.sh"

SYSTEM_API_DIR="$DEPLOY_DIR/state/system-api"
zitadel_generate_system_api_files \
    "$SYSTEM_API_DIR" \
    "/system-api/system-user.pub" \
    "init-system-api.sh"
