#!/usr/bin/env bash
#
# Zitadel API compatibility loader.

ZITADEL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/zitadel-lib" && pwd)"

# shellcheck source=deploy/scripts/common/zitadel-lib/jwt.sh
source "$ZITADEL_LIB_DIR/jwt.sh"
# shellcheck source=deploy/scripts/common/zitadel-lib/token.sh
source "$ZITADEL_LIB_DIR/token.sh"
# shellcheck source=deploy/scripts/common/zitadel-lib/health.sh
source "$ZITADEL_LIB_DIR/health.sh"
# shellcheck source=deploy/scripts/common/zitadel-lib/system-api.sh
source "$ZITADEL_LIB_DIR/system-api.sh"
