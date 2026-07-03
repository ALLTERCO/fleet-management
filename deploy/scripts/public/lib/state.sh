# shellcheck shell=bash
# lib/state.sh — compatibility loader for public deploy state helpers.

PUBLIC_STATE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/state" && pwd)"

# shellcheck source=deploy/scripts/public/lib/state/secrets.sh
source "$PUBLIC_STATE_LIB_DIR/secrets.sh"
# shellcheck source=deploy/scripts/public/lib/state/env.sh
source "$PUBLIC_STATE_LIB_DIR/env.sh"
# shellcheck source=deploy/scripts/public/lib/state/meta.sh
source "$PUBLIC_STATE_LIB_DIR/meta.sh"
# shellcheck source=deploy/scripts/public/lib/state/init-sql.sh
source "$PUBLIC_STATE_LIB_DIR/init-sql.sh"
# shellcheck source=deploy/scripts/public/lib/state/retention.sh
source "$PUBLIC_STATE_LIB_DIR/retention.sh"
