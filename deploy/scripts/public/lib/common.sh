# shellcheck shell=bash
# lib/common.sh — compatibility loader for public deploy shared helpers.

PUBLIC_COMMON_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/common" && pwd)"

# shellcheck source=deploy/scripts/public/lib/common/logging.sh
source "$PUBLIC_COMMON_LIB_DIR/logging.sh"
# shellcheck source=deploy/scripts/public/lib/common/runtime.sh
source "$PUBLIC_COMMON_LIB_DIR/runtime.sh"
# shellcheck source=deploy/scripts/public/lib/common/env.sh
source "$PUBLIC_COMMON_LIB_DIR/env.sh"
# shellcheck source=deploy/scripts/public/lib/common/args.sh
source "$PUBLIC_COMMON_LIB_DIR/args.sh"
# shellcheck source=deploy/scripts/common/kdf-salt.sh
source "$PUBLIC_COMMON_LIB_DIR/../../../common/kdf-salt.sh"
# shellcheck source=deploy/scripts/common/edge-network.sh
source "$PUBLIC_COMMON_LIB_DIR/../../../common/edge-network.sh"
