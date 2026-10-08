#!/usr/bin/env bash
# Hook registry for Business Manager demo fixtures.
#
# The fixtures themselves live in seed/bm-demo/ and are excluded from the
# public export. This registry is the generic mechanism and always ships: it
# names no fixture, so the orchestrator never has to.
#
# A fixture registers what it does; seed-lib.sh asks for a phase. That keeps
# one source of truth per fixture — the fixture's own file — instead of a
# second list of names in the orchestrator that has to be kept in step.
#
# Idempotent: safe to source from seed-lib.sh and from a fixture module that a
# test sources on its own.

[ -n "${_BM_REGISTRY_LOADED:-}" ] && return 0
_BM_REGISTRY_LOADED=1

# Phases, in the order seed_run dispatches them.
#   prepare           location tree and tariffs, before devices exist
#   assign            device assignment
#   assign_after_blu  assignment that needs promoted BLU children to exist
#   assign_late       assignment that must follow every other assign step
#   alerts            alert rules, after device data is finalised
#   catalog           emits a location catalog on stdout (see bm_demo_catalog)
#   reset_legacy      clears rows an earlier catalog left behind, on --reset
_BM_PREPARE=()
_BM_ASSIGN=()
_BM_ASSIGN_AFTER_BLU=()
_BM_ASSIGN_LATE=()
_BM_ALERTS=()
_BM_CATALOG=()
_BM_RESET_LEGACY=()

# Usage: bm_demo_register <phase> <function>
bm_demo_register() {
    local phase="$1" fn="$2"
    case "$phase" in
        prepare) _BM_PREPARE+=("$fn") ;;
        assign) _BM_ASSIGN+=("$fn") ;;
        assign_after_blu) _BM_ASSIGN_AFTER_BLU+=("$fn") ;;
        assign_late) _BM_ASSIGN_LATE+=("$fn") ;;
        alerts) _BM_ALERTS+=("$fn") ;;
        catalog) _BM_CATALOG+=("$fn") ;;
        reset_legacy) _BM_RESET_LEGACY+=("$fn") ;;
        *)
            echo "bm_demo_register: unknown phase '$phase'" >&2
            return 1
            ;;
    esac
}

_bm_demo_hooks() {
    case "$1" in
        prepare) printf '%s\n' ${_BM_PREPARE[@]+"${_BM_PREPARE[@]}"} ;;
        assign) printf '%s\n' ${_BM_ASSIGN[@]+"${_BM_ASSIGN[@]}"} ;;
        assign_after_blu)
            printf '%s\n' ${_BM_ASSIGN_AFTER_BLU[@]+"${_BM_ASSIGN_AFTER_BLU[@]}"}
            ;;
        assign_late) printf '%s\n' ${_BM_ASSIGN_LATE[@]+"${_BM_ASSIGN_LATE[@]}"} ;;
        alerts) printf '%s\n' ${_BM_ALERTS[@]+"${_BM_ALERTS[@]}"} ;;
        catalog) printf '%s\n' ${_BM_CATALOG[@]+"${_BM_CATALOG[@]}"} ;;
        reset_legacy)
            printf '%s\n' ${_BM_RESET_LEGACY[@]+"${_BM_RESET_LEGACY[@]}"}
            ;;
        *)
            echo "bm_demo_run: unknown phase '$1'" >&2
            return 1
            ;;
    esac
}

# Run every hook registered for a phase. Each hook self-guards on the active
# FM_SEED_PROFILE and returns early unless it owns it, so order within a phase
# does not matter and an inactive fixture costs nothing.
bm_demo_run() {
    local phase="$1" fn
    while IFS= read -r fn; do
        [ -n "$fn" ] || continue
        "$fn"
    done < <(_bm_demo_hooks "$phase")
}

# Emit the first non-empty catalog a registered fixture produces. Returns
# non-zero when no fixture supplies one, so the caller can fall back.
bm_demo_catalog() {
    local fn out
    while IFS= read -r fn; do
        [ -n "$fn" ] || continue
        out="$("$fn")"
        if [ -n "$out" ]; then
            printf '%s\n' "$out"
            return 0
        fi
    done < <(_bm_demo_hooks catalog)
    return 1
}
