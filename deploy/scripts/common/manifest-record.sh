#!/usr/bin/env bash
# High-level manifest recording for install / client-add / client-remove / update.
# Builds on deploy/scripts/common/manifest.sh primitives.
#
# All functions read input from env vars (set by callers via load_client_env,
# resolve_deploy_public_topology, etc.) — see CLAUDE.md "max 2 arguments" rule.
# Single positional arg (when present) is the entity id, since it's the natural
# subject of the operation.

# ── Public lifecycle entry points ──────────────────────────────────────

# Records install or re-install. Reads ENV_NAME, SSL_MODE, ROUTING, DOMAIN,
# ZITADEL_* topology, FM_HOSTNAME, FM_VERSION, *_VERSION from env.
manifest_record_install() {
    local manifest_was_present=0
    [ -f "$(manifest_path)" ] && manifest_was_present=1

    local content
    if [ "$manifest_was_present" = "1" ]; then
        manifest_snapshot || return 1
        content="$(manifest_read)" || return 1
    else
        content="$(manifest_init "${ENV_NAME:-}" "$(_manifest_detect_mode)" "${SSL_MODE:-}" "${ROUTING:-}")"
    fi

    content="$(_manifest_apply_envelope "$content")"
    content="$(_manifest_apply_topology "$content")"
    content="$(_manifest_set_shared_services "$content")" || return 1
    content="$(_manifest_apply_contract_version "$content")" || return 1
    manifest_write "$content" || return 1

    if [ "$manifest_was_present" = "1" ]; then
        local revision; revision="$(manifest_revision_next)"
        manifest_add_history "$revision" "install" "all" "{}"
    fi
}

# Record volumes kept as-is (external, never relabeled) during an update, so the
# manifest reflects which volumes are legacy-unlabeled. Args: kept volume names.
manifest_record_volumes_kept() {
    [ "$#" -gt 0 ] || return 0
    [ -f "$(manifest_path)" ] || return 0
    local list payload revision
    list="$(printf '"%s",' "$@")"
    payload="{\"kept\":[${list%,}]}"
    revision="$(manifest_revision_next)"
    manifest_add_history "$revision" "volumes-kept" "all" "$payload"
}

# Add a client. Reads CLIENT_ID, CLIENT_DOMAIN, ADDONS_CSV, FM_IMAGE_TAG,
# DB_NAME, REDIS_USER from env (caller has loaded the client env file).
manifest_record_client_add() {
    : "${CLIENT_ID:?CLIENT_ID required (set via load_client_env)}"
    [ -f "$(manifest_path)" ] || return 0

    local revision; revision="$(manifest_revision_next)"
    local entry; entry="$(_manifest_build_client_entry "$revision")"

    manifest_snapshot "$revision"
    local current updated
    current="$(manifest_read)"
    updated="$(printf '%s' "$current" | jq --arg id "$CLIENT_ID" --argjson entry "$entry" '.clients[$id] = $entry')"
    updated="$(_manifest_apply_contract_version "$updated")" || return 1
    manifest_write "$updated"

    local image="${FM_IMAGE_TAG:-fleet-manager:${FM_VERSION:-latest}}"
    manifest_add_history "$revision" "client-add" "$CLIENT_ID" "$(jq -n --arg image "$image" '{image: $image}')"
}

# Remove a client. Single positional: client id.
manifest_record_client_remove() {
    local id="$1"
    [ -f "$(manifest_path)" ] || return 0

    local revision; revision="$(manifest_revision_next)"
    manifest_snapshot "$revision"
    local current updated
    current="$(manifest_read)"
    updated="$(printf '%s' "$current" | jq --arg id "$id" 'del(.clients[$id])')"
    updated="$(_manifest_apply_contract_version "$updated")" || return 1
    manifest_write "$updated"

    manifest_add_history "$revision" "client-remove" "$id" "{}"
}

# Record OSS single-tenant FM update. Reads UPDATE_FROM_IMAGE,
# UPDATE_TO_IMAGE, UPDATE_BACKUP_PATH, UPDATE_BACKUP_MANIFEST_PATH from env.
manifest_record_public_update() {
    : "${UPDATE_TO_IMAGE:?UPDATE_TO_IMAGE required}"
    [ -f "$(manifest_path)" ] || return 0

    local revision; revision="$(manifest_revision_next)"
    local ts; ts="$(_manifest_iso8601)"

    manifest_snapshot "$revision"
    local current updated
    current="$(manifest_read)"
    updated="$(printf '%s' "$current" | jq \
        --arg image "$UPDATE_TO_IMAGE" \
        --arg ts    "$ts" \
        '.shared_services.fleet_manager.image = $image |
         .shared_services.fleet_manager.last_updated_at = $ts |
         .shared_services.fleet_manager.labels["fleet.version"] = $image')"
    updated="$(_manifest_apply_contract_version "$updated")" || return 1
    manifest_write "$updated"

    local extra
    extra="$(jq -n \
        --arg from   "${UPDATE_FROM_IMAGE:-}" \
        --arg to     "$UPDATE_TO_IMAGE" \
        --arg backup "${UPDATE_BACKUP_PATH:-}" \
        --arg backup_manifest "${UPDATE_BACKUP_MANIFEST_PATH:-}" \
        '{from_image: $from, to_image: $to, backup: $backup, backup_manifest: $backup_manifest}')"
    manifest_add_history "$revision" "public-update" "fleet_manager" "$extra"
}

# Record per-tenant update. Reads UPDATE_FROM_IMAGE, UPDATE_TO_IMAGE,
# UPDATE_BACKUP_PATH, UPDATE_BACKUP_MANIFEST_PATH from env; back-fills client
# entry from CLIENT_DOMAIN / DB_NAME / REDIS_USER if absent (legacy install).
manifest_record_client_update() {
    local id="$1"
    : "${UPDATE_TO_IMAGE:?UPDATE_TO_IMAGE required}"
    [ -f "$(manifest_path)" ] || return 0

    # Back-fill if absent — auto-migrate legacy installs.
    if [ "$(manifest_get_field ".clients[\"${id}\"].id")" != "$id" ]; then
        CLIENT_ID="$id" FM_IMAGE_TAG="$UPDATE_TO_IMAGE" manifest_record_client_add
    fi

    local revision; revision="$(manifest_revision_next)"
    local ts; ts="$(_manifest_iso8601)"

    manifest_snapshot "$revision"
    local current updated
    current="$(manifest_read)"
    updated="$(printf '%s' "$current" | jq \
        --arg id       "$id" \
        --arg image    "$UPDATE_TO_IMAGE" \
        --arg ts       "$ts" \
        --arg revision "$revision" \
        '.clients[$id].image = $image |
         .clients[$id].labels["fleet.version"] = $image |
         .clients[$id].last_updated_at = $ts |
         .clients[$id].last_revision = $revision')"
    updated="$(_manifest_apply_contract_version "$updated")" || return 1
    manifest_write "$updated"

    local extra
    extra="$(jq -n \
        --arg from   "${UPDATE_FROM_IMAGE:-}" \
        --arg to     "$UPDATE_TO_IMAGE" \
        --arg backup "${UPDATE_BACKUP_PATH:-}" \
        --arg backup_manifest "${UPDATE_BACKUP_MANIFEST_PATH:-}" \
        '{from_image: $from, to_image: $to, backup: $backup, backup_manifest: $backup_manifest}')"
    manifest_add_history "$revision" "client-update" "$id" "$extra"
}

# Record a rollback to fm-<id>:rollback. Sibling of manifest_record_client_update.
# Pre-condition: caller has already swung the tenant container to the rollback image.
manifest_record_client_rollback() {
    local id="$1"
    [ -f "$(manifest_path)" ] || return 0

    local revision; revision="$(manifest_revision_next)"
    local ts; ts="$(_manifest_iso8601)"
    manifest_snapshot "$revision"

    local current updated
    current="$(manifest_read)" || return 1
    updated="$(printf '%s' "$current" | jq \
        --arg id       "$id" \
        --arg image    "fm-${id}:rollback" \
        --arg ts       "$ts" \
        --arg revision "$revision" \
        '.clients[$id].image = $image |
         .clients[$id].labels["fleet.version"] = $image |
         .clients[$id].last_updated_at = $ts |
         .clients[$id].last_revision = $revision')"
    updated="$(_manifest_apply_contract_version "$updated")" || return 1
    manifest_write "$updated"
    manifest_add_history "$revision" "client-rollback" "$id" "{}"
}

# Record per-tenant active-color flip (blue-green deploy).
# Reads CLIENT_ACTIVE_COLOR, CLIENT_PREV_COLOR.
manifest_record_client_color_flip() {
    local id="$1"
    : "${CLIENT_ACTIVE_COLOR:?CLIENT_ACTIVE_COLOR required (blue|green)}"
    [ -f "$(manifest_path)" ] || return 0

    local revision; revision="$(manifest_revision_next)"
    local ts; ts="$(_manifest_iso8601)"

    manifest_snapshot "$revision"
    local current updated
    current="$(manifest_read)"
    updated="$(printf '%s' "$current" | jq \
        --arg id    "$id" \
        --arg color "$CLIENT_ACTIVE_COLOR" \
        --arg ts    "$ts" \
        '.clients[$id].active_color = $color |
         .clients[$id].last_updated_at = $ts')"
    updated="$(_manifest_apply_contract_version "$updated")" || return 1
    manifest_write "$updated"

    local extra
    extra="$(jq -n \
        --arg prev "${CLIENT_PREV_COLOR:-}" \
        --arg new  "$CLIENT_ACTIVE_COLOR" \
        '{from_color: $prev, to_color: $new}')"
    manifest_add_history "$revision" "client-color-flip" "$id" "$extra"
}

# ── Internal helpers ───────────────────────────────────────────────────

_manifest_detect_mode() {
    if [ "${SHARED:-false}" = "true" ]; then
        printf '%s' "shared"
    elif [ "${FULL:-false}" = "true" ]; then
        printf '%s' "full"
    else
        printf '%s' "single-tenant"
    fi
}

# Apply env/mode/ssl_mode/routing from env onto existing manifest content.
_manifest_apply_envelope() {
    local content="$1"
    local identity; identity="$(_manifest_identity_json)"
    local host; host="$(_manifest_host_json)"
    local config_hash; config_hash="$(_manifest_config_hash)"
    printf '%s' "$content" | jq \
        --arg env      "${ENV_NAME:-}" \
        --arg mode     "$(_manifest_detect_mode)" \
        --arg ssl_mode "${SSL_MODE:-}" \
        --arg routing  "${ROUTING:-}" \
        --arg frontend_version "${FM_FRONTEND_ARTIFACT_VERSION:-}" \
        --arg config_hash "$config_hash" \
        --argjson identity "$identity" \
        --argjson host "$host" \
        '.env = $env |
         .mode = $mode |
         .ssl_mode = $ssl_mode |
         .routing = $routing |
         .identity = $identity |
         .host = $host |
         .frontend_artifact_version = (if $frontend_version == "" then null else $frontend_version end) |
         .config_hash = (if $config_hash == "" then null else $config_hash end)'
}

# Host facts for the manifest: OS/arch (from detect_os) + docker engine version.
_manifest_host_json() {
    local os arch docker_version
    os="${OS:-$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')}"
    arch="${ARCH:-$(uname -m 2>/dev/null)}"
    docker_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
    jq -n \
        --arg os "$os" \
        --arg arch "$arch" \
        --arg docker_version "$docker_version" \
        '{os: $os, arch: $arch,
          docker_version: (if $docker_version == "" then null else $docker_version end)}'
}

# Fingerprint of the resolved runtime config so two instances can be compared.
_manifest_config_hash() {
    local f="${STATE_DIR:-./state}/fm-runtime.env"
    [ -f "$f" ] || return 0
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$f" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$f" | awk '{print $1}'
    fi
}

# Apply topology + domain from env onto content. Skip empty values so re-running
# `up` from a bare shell doesn't wipe prior good topology.
_manifest_apply_topology() {
    local content="$1"

    if [ -n "${DOMAIN:-}" ]; then
        content="$(printf '%s' "$content" | jq --arg domain "$DOMAIN" '.domain = $domain')"
    fi

    local _spec _env_name _field _v
    for _spec in ZITADEL_EXTERNALSECURE:zitadel_external_secure \
                 ZITADEL_EXTERNALPORT:zitadel_external_port \
                 ZITADEL_PUBLIC_SCHEME:zitadel_public_scheme \
                 ZITADEL_HOSTNAME:zitadel_hostname \
                 ZITADEL_TLS_MODE:zitadel_tls_mode \
                 FM_HOSTNAME:fm_hostname; do
        _env_name="${_spec%%:*}"
        _field="${_spec##*:}"
        _v="${!_env_name:-}"
        [ -z "$_v" ] && continue
        content="$(printf '%s' "$content" | jq --arg v "$_v" --arg f "$_field" '.topology[$f] = $v')"
    done
    printf '%s' "$content"
}

# Build a complete client entry JSON object from env. Caller passes the revision.
_manifest_build_client_entry() {
    local revision="$1"
    local image="${FM_IMAGE_TAG:-fleet-manager:${FM_VERSION:-latest}}"
    local domain="${CLIENT_DOMAIN:-}"
    local db_name="${DB_NAME:-$CLIENT_ID}"
    local redis_user="${REDIS_USER:-fm-tenant-$CLIENT_ID}"
    local addons_csv="${ADDONS_CSV:-}"
    local ts; ts="$(_manifest_iso8601)"
    local labels; labels="$(_manifest_labels_json "fleet-manager" "$image" "$CLIENT_ID" "shared-client" "fm-$CLIENT_ID")"

    jq -n \
        --arg id         "$CLIENT_ID" \
        --arg domain     "$domain" \
        --arg image      "$image" \
        --arg db_name    "$db_name" \
        --arg redis_user "$redis_user" \
        --arg addons     "$addons_csv" \
        --arg ts         "$ts" \
        --arg revision   "$revision" \
        --argjson labels "$labels" \
        '{
            id: $id, domain: $domain, image: $image,
            db_name: $db_name, redis_user: $redis_user,
            labels: $labels,
            addons: ($addons | split(",") | map(select(. != ""))),
            active_color: "blue",
            first_deployed_at: $ts,
            last_updated_at:   $ts,
            last_revision:     $revision
        }'
}

_manifest_set_shared_services() {
    local content="$1"
    local ts; ts="$(_manifest_iso8601)"
    local services
    services="$(jq -n \
        --arg fm_image       "fleet-manager:${FM_VERSION:-latest}" \
        --arg fm_digest      "${FM_IMAGE_DIGEST:-}" \
        --arg zitadel_image  "ghcr.io/zitadel/zitadel:${ZITADEL_VERSION:-}" \
        --arg zitadel_login_image "ghcr.io/zitadel/zitadel-login:${ZITADEL_VERSION:-}" \
        --arg redis_image    "redis:${REDIS_VERSION:-7.4.2-alpine}" \
        --arg traefik_image  "traefik:${TRAEFIK_VERSION:-}" \
        --arg pg_image       "timescale/timescaledb:${TIMESCALEDB_VERSION:-}" \
        --arg zpg_image      "postgres:${ZITADEL_POSTGRES_VERSION:-}" \
        --arg ts             "$ts" \
        --argjson fleet_db_labels "$(_manifest_labels_json "fleet-db" "timescale/timescaledb:${TIMESCALEDB_VERSION:-}")" \
        --argjson zitadel_db_labels "$(_manifest_labels_json "zitadel-db" "postgres:${ZITADEL_POSTGRES_VERSION:-}")" \
        --argjson zitadel_api_labels "$(_manifest_labels_json "zitadel-api" "ghcr.io/zitadel/zitadel:${ZITADEL_VERSION:-}")" \
        --argjson zitadel_login_labels "$(_manifest_labels_json "zitadel-login" "ghcr.io/zitadel/zitadel-login:${ZITADEL_VERSION:-}")" \
        --argjson redis_labels "$(_manifest_labels_json "redis" "redis:${REDIS_VERSION:-7.4.2-alpine}")" \
        --argjson traefik_labels "$(_manifest_labels_json "traefik" "traefik:${TRAEFIK_VERSION:-}")" \
        --argjson fleet_manager_labels "$(_manifest_labels_json "fleet-manager" "fleet-manager:${FM_VERSION:-latest}")" \
        '{
            fleet_db:      {image: $pg_image,      last_updated_at: $ts, labels: $fleet_db_labels},
            zitadel_db:    {image: $zpg_image,     last_updated_at: $ts, labels: $zitadel_db_labels},
            zitadel_api:   {image: $zitadel_image, last_updated_at: $ts, labels: $zitadel_api_labels},
            zitadel_login: {image: $zitadel_login_image, last_updated_at: $ts, labels: $zitadel_login_labels},
            redis:         {image: $redis_image,   last_updated_at: $ts, labels: $redis_labels},
            traefik:       {image: $traefik_image, last_updated_at: $ts, labels: $traefik_labels},
            fleet_manager: {image: $fm_image,      image_digest: (if $fm_digest == "" then null else $fm_digest end), last_updated_at: $ts, labels: $fleet_manager_labels}
        }')"
    printf '%s' "$content" | jq --argjson svc "$services" '.shared_services = $svc'
}

_manifest_identity_json() {
    jq -n \
        --arg managed_by      "${FM_MANAGED_BY:-fleet-manager}" \
        --arg client_id       "${FM_CLIENT_ID:-shared}" \
        --arg environment_id  "${FM_ENVIRONMENT_ID:-${ENV_NAME:-unknown}}" \
        --arg topology_mode   "${FM_TOPOLOGY_MODE:-$(_manifest_detect_mode)}" \
        --arg compose_project "${FM_COMPOSE_PROJECT_NAME:-${COMPOSE_PROJECT_NAME:-fm}}" \
        --arg build_commit    "${FM_BUILD_COMMIT:-${GIT_COMMIT:-}}" \
        '{
            managed_by: $managed_by,
            client_id: $client_id,
            environment_id: $environment_id,
            topology_mode: $topology_mode,
            compose_project: $compose_project,
            build_commit: $build_commit
        }'
}

_manifest_labels_json() {
    local service="$1"
    local version="$2"
    local client="${3:-${FM_CLIENT_ID:-shared}}"
    local mode="${4:-${FM_TOPOLOGY_MODE:-$(_manifest_detect_mode)}}"
    local compose_project="${5:-${FM_COMPOSE_PROJECT_NAME:-${COMPOSE_PROJECT_NAME:-fm}}}"

    jq -n \
        --arg managed_by      "${FM_MANAGED_BY:-fleet-manager}" \
        --arg client          "$client" \
        --arg environment_id  "${FM_ENVIRONMENT_ID:-${ENV_NAME:-unknown}}" \
        --arg mode            "$mode" \
        --arg version         "$version" \
        --arg build_commit    "${FM_BUILD_COMMIT:-${GIT_COMMIT:-unknown}}" \
        --arg compose_project "$compose_project" \
        --arg service         "$service" \
        '{
            "fleet.managed_by": $managed_by,
            "fleet.client": $client,
            "fleet.environment": $environment_id,
            "fleet.mode": $mode,
            "fleet.version": $version,
            "fleet.commit": $build_commit,
            "fleet.compose_project": $compose_project,
            "fleet.service": $service
        }'
}

_manifest_contract_v2_enabled() {
    [ "${FM_CONTRACT_MANIFEST_V2:-false}" = "true" ]
}

_manifest_apply_contract_version() {
    local content="$1"
    if _manifest_contract_v2_enabled; then
        _manifest_to_v2 "$content"
    else
        printf '%s' "$content"
    fi
}

_manifest_to_v2() {
    local content="$1"
    local ts; ts="$(_manifest_iso8601)"
    local build_commit="${FM_BUILD_COMMIT:-${GIT_COMMIT:-unknown}}"

    printf '%s' "$content" | jq \
        --arg ts "$ts" \
        --arg build_commit "$build_commit" \
        '
        def commit_value($fallback):
            if $build_commit != "" and $build_commit != "unknown" then $build_commit
            else ($fallback // "unknown")
            end;
        def image_tag($image):
            ($image // "unknown") as $img |
            if ($img | contains(":")) then ($img | split(":") | last) else "unknown" end;
        def normalize_labels($labels):
            ($labels // {}) as $l |
            $l + {"fleet.commit": commit_value($l["fleet.commit"])};
        def check_result($name):
            {
                schema_version: 1,
                name: $name,
                status: "not_run",
                started_at: $ts,
                finished_at: $ts,
                duration_s: 0,
                log_artifact: null,
                summary: ($name + " check has not run")
            };
        def default_checks:
            {
                migration: check_result("migration"),
                smoke: check_result("smoke"),
                api: check_result("api"),
                browser: check_result("browser")
            };
        def certificate_status($ssl_mode):
            # Mode strings are facts (what was configured). "letsencrypt" is
            # unknown until an actual probe confirms issuance — never assert valid.
            if $ssl_mode == "selfsigned" then "selfsigned"
            elif $ssl_mode == "custom" then "custom"
            elif $ssl_mode == "letsencrypt" then "unknown"
            elif $ssl_mode == "off" then "not_configured"
            else "unknown"
            end;

        .schema_version = 2 |
        .identity.build_commit = commit_value(.identity.build_commit) |
        .domains = (.domains // ([
            (.domain // empty | select(. != "") | {name: ., kind: "fleet"}),
            (.topology.zitadel_hostname // empty | select(. != "") | {name: ., kind: "zitadel"})
        ] | unique_by(.name + ":" + .kind))) |
        .certificates = (.certificates // (
            if (.domain // "") != "" then
                [{
                    domain: .domain,
                    status: certificate_status(.ssl_mode // ""),
                    checked_at: $ts
                }]
            else []
            end
        )) |
        .checks = (default_checks + (.checks // {})) |
        .rollback = (.rollback // {
            available: false,
            reason: "not_checked",
            backup_manifest_path: null,
            checked_at: $ts
        }) |
        .redaction = (.redaction // {
            status: "unknown",
            checked_at: $ts
        }) |
        .generated_at = $ts |
        .shared_services = ((.shared_services // {}) | with_entries(
            .value = (
                .value as $svc |
                ($svc.labels // {}) as $labels |
                ($svc.image // "unknown") as $image |
                $svc + {
                    service: ($labels["fleet.service"] // $svc.service // .key),
                    container_name: ($svc.container_name // null),
                    image: $image,
                    image_tag: ($svc.image_tag // image_tag($image)),
                    image_digest: ($svc.image_digest // null),
                    commit: commit_value($svc.commit // $labels["fleet.commit"]),
                    labels: normalize_labels($labels),
                    last_updated_at: ($svc.last_updated_at // $ts)
                }
            )
        )) |
        .clients = ((.clients // {}) | with_entries(
            .value = (
                .value as $client |
                ($client.labels // {}) as $labels |
                ($client.image // ($client.containers[0].image // "unknown")) as $image |
                ($client.last_updated_at // $ts) as $last_updated_at |
                $client + {
                    mode: ($client.mode // "shared-client"),
                    labels: normalize_labels($labels),
                    containers: [{
                        service: "fleet-manager",
                        container_name: ($client.container_name // null),
                        image: $image,
                        image_tag: image_tag($image),
                        image_digest: ($client.image_digest // null),
                        commit: commit_value($client.commit // $labels["fleet.commit"]),
                        labels: normalize_labels($labels),
                        last_updated_at: $last_updated_at
                    }]
                }
            )
        ))'
}
