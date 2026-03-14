#!/usr/bin/env bash
#
# deploy-public.sh — wrapper
#
# Forwards to the modular implementation in deploy/scripts/public/.
# Kept at the original path for backwards compatibility.

exec "$(dirname "$0")/scripts/public/deploy-public.sh" "$@"
