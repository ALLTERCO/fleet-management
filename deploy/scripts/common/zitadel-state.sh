# shellcheck shell=bash
# Shared Zitadel DB-state truth. Sourced by private deploy.sh and public
# deploy-public.sh. Each caller resolves the zitadel-db container its own way
# (compat lookup vs public container_name) and delegates the event-store probe
# here so the marker-table set lives in exactly one place.

# DB-truth: is the Zitadel event store present? A stale state/zitadel.env can
# outlive a wiped volume, and start-from-setup on an empty DB fails. Any one
# marker table (events/events2 across versions, or projection/system) counts.
# Args: <container> [psql_user=postgres] [psql_db=zitadel]. Empty container -> 1.
zitadel_event_store_initialized() {
    local container="$1"
    local user="${2:-postgres}"
    local db="${3:-zitadel}"
    [ -n "$container" ] || return 1
    [ "$(docker exec "$container" psql -U "$user" -d "$db" -tAc \
          "SELECT (to_regclass('eventstore.events') IS NOT NULL
                OR to_regclass('eventstore.events2') IS NOT NULL
                OR to_regclass('projections.current_states') IS NOT NULL
                OR to_regclass('system.instances') IS NOT NULL);" \
          2>/dev/null | tr -d '[:space:]')" = "t" ]
}
