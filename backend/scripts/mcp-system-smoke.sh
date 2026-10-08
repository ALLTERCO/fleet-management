#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${MCP_SYSTEM_REPORT_DIR:-$REPO_ROOT/report/mcp-system}"
RESULT_PATH="$REPORT_DIR/docker-mcp-system-results.json"
RAW_RESULT_PATH="$REPORT_DIR/docker-mcp-system-results.raw.json"
SCOPED_RESULT_PATH="$REPORT_DIR/scoped-automation-system-results.json"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
BASELINE_ARTIFACT_DIR="${MCP_SYSTEM_BASELINE_ARTIFACT_DIR:-}"
BASELINE_CONFIGURED_BUILD_COMMIT="${MCP_SYSTEM_BASELINE_EXPECTED_BUILD_COMMIT:-}"
RUN_ID="mcp-system-$(date -u +%Y%m%d%H%M%S)-$$"
RUNTIME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${RUN_ID}.XXXXXX")"
CANDIDATE_PG_NAME="${RUN_ID}-candidate-pg"
BASELINE_PG_NAME=""
CANDIDATE_REDIS_NAME="${RUN_ID}-candidate-redis"
BASELINE_REDIS_NAME="${RUN_ID}-baseline-redis"
CANDIDATE_NODERED_NAME="${RUN_ID}-candidate-nodered"
BASELINE_NODERED_NAME="${RUN_ID}-baseline-nodered"
BASELINE_PID=""
CANDIDATE_PID=""
SCOPED_IDP_PID=""
BASELINE_SIMULATOR_PID_FILE="$RUNTIME_DIR/baseline-simulator.pid"
CANDIDATE_SIMULATOR_PID_FILE="$RUNTIME_DIR/candidate-simulator.pid"
CLEANED=0
CLEANUP_STATUS="passed"
CLEANUP_ERRORS="[]"
PHASE="prerequisites"
RUN_REPORT_KIND="disposable-real-http-mcp-smoke"

mkdir -p "$REPORT_DIR"
rm -f \
    "$RESULT_PATH" \
    "$RAW_RESULT_PATH" \
    "$SCOPED_RESULT_PATH" \
    "$REPORT_DIR/docker-mcp-system-baseline.redacted.log" \
    "$REPORT_DIR/docker-mcp-system-candidate.redacted.log"

tree_hash() {
    python3 - "$1" <<'PY'
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
digest = hashlib.sha256()
for path in sorted(p for p in root.rglob('*') if p.is_file()):
    digest.update(path.relative_to(root).as_posix().encode())
    digest.update(b'\0')
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
print(digest.hexdigest())
PY
}

resource_paths() {
    jq -r \
        '[
            ((.mcpResources // [])[] | .source),
            ((.mcpSearchResources // [])[] | .source),
            ((.resources // [])[] | .path)
        ] | unique[]' \
        "$1/docs/generated/ai-index.json"
}

valid_relative_path() {
    case "$1" in
        ""|/*|..|../*|*/../*|*/..) return 1 ;;
        *) return 0 ;;
    esac
}

resource_set_hash() {
    local source_root="$1" relative_path
    {
        while IFS= read -r relative_path; do
            valid_relative_path "$relative_path" || {
                printf 'Unsafe MCP resource path in ai-index: %s\n' "$relative_path" >&2
                return 1
            }
            [ -f "$source_root/$relative_path" ] || {
                printf 'Missing MCP resource declared by ai-index: %s\n' "$relative_path" >&2
                return 1
            }
            printf '%s\n' "$relative_path"
            shasum -a 256 "$source_root/$relative_path" | awk '{print $1}'
        done < <(resource_paths "$source_root")
    } | shasum -a 256 | awk '{print $1}'
}

artifact_hash() {
    local source_root="$1"
    {
        printf 'dist %s\n' "$(tree_hash "$source_root/backend/dist")"
        printf 'db %s\n' "$(tree_hash "$source_root/backend/db")"
        printf 'static %s\n' "$(tree_hash "$source_root/backend/static")"
        printf 'package %s\n' "$(shasum -a 256 "$source_root/backend/package.json" | awk '{print $1}')"
        printf 'docs %s\n' "$(tree_hash "$source_root/docs/generated")"
        printf 'resources %s\n' "$(resource_set_hash "$source_root")"
        printf 'fleet-nodes %s\n' "$(tree_hash "$source_root/packages/node-red-fleet-manager")"
    } | shasum -a 256 | awk '{print $1}'
}

require_artifact() {
    local source_root="$1" label="$2" required
    for required in \
        backend/dist/app.js \
        backend/db \
        backend/static \
        backend/package.json \
        backend/node_modules \
        packages/node-red-fleet-manager/nodes/fm-nodes.js \
        docs/generated/ai-index.json; do
        [ -e "$source_root/$required" ] || {
            printf '%s artifact is missing %s.\n' "$label" "$required" >&2
            return 1
        }
    done
    resource_set_hash "$source_root" >/dev/null
}

snapshot_source() {
    local source_root="$1" target_root="$2" label="$3"
    local before_hash after_hash copied_hash relative_path attempt snapshot_ok=false
    require_artifact "$source_root" "$label"
    for ((attempt=1; attempt<=3; attempt++)); do
        before_hash="$(artifact_hash "$source_root")"
        rm -rf "$target_root"
        mkdir -p "$target_root/backend" "$target_root/docs/generated"
        rsync -a "$source_root/backend/dist/" "$target_root/backend/dist/"
        rsync -a "$source_root/backend/db/" "$target_root/backend/db/"
        rsync -a "$source_root/backend/static/" "$target_root/backend/static/"
        cp "$source_root/backend/package.json" "$target_root/backend/package.json"
        rsync -a "$source_root/docs/generated/" "$target_root/docs/generated/"
        mkdir -p "$target_root/packages/node-red-fleet-manager"
        rsync -a "$source_root/packages/node-red-fleet-manager/" "$target_root/packages/node-red-fleet-manager/"
        while IFS= read -r relative_path; do
            valid_relative_path "$relative_path" || {
                printf 'Unsafe MCP resource path in ai-index: %s\n' "$relative_path" >&2
                return 1
            }
            mkdir -p "$target_root/$(dirname "$relative_path")"
            cp "$source_root/$relative_path" "$target_root/$relative_path"
        done < <(resource_paths "$source_root")
        ln -s "$source_root/backend/node_modules" "$target_root/backend/node_modules"
        after_hash="$(artifact_hash "$source_root")"
        copied_hash="$(artifact_hash "$target_root")"
        if [ "$before_hash" = "$after_hash" ] && [ "$after_hash" = "$copied_hash" ]; then
            snapshot_ok=true
            break
        fi
    done
    [ "$snapshot_ok" = true ] || {
        printf '%s artifact changed while it was being snapshotted.\n' "$label" >&2
        return 1
    }
}

free_port() {
    python3 - <<'PY'
import socket

with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
}

mapped_port() {
    docker port "$1" "$2/tcp" | awk -F: 'NR == 1 {print $NF}'
}

wait_for_container() {
    local name="$1" attempts="${2:-120}" i=0
    while [ "$i" -lt "$attempts" ]; do
        if [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)" = "healthy" ]; then
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done
    docker logs --tail 80 "$name" >&2 2>/dev/null || true
    return 1
}

wait_for_http() {
    local url="$1" attempts="${2:-180}" header="${3:-}" i=0
    while [ "$i" -lt "$attempts" ]; do
        local -a curl_args=(-fsS --connect-timeout 2 --max-time 4)
        if [ -n "$header" ]; then curl_args+=(-H "$header"); fi
        if curl "${curl_args[@]}" "$url" >/dev/null 2>&1; then
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done
    return 1
}

wait_for_backend() {
    local url="$1" pid="$2" label="$3" attempts="${4:-120}" i=0
    while [ "$i" -lt "$attempts" ]; do
        if curl -fsS --connect-timeout 2 --max-time 4 "$url" >/dev/null 2>&1; then
            return 0
        fi
        if ! kill -0 "$pid" 2>/dev/null; then
            wait "$pid" 2>/dev/null || true
            printf '%s backend exited before becoming ready; retained redacted log evidence.\n' "$label" >&2
            return 1
        fi
        i=$((i + 1))
        sleep 1
    done
    printf '%s backend did not become ready; retained redacted log evidence.\n' "$label" >&2
    return 1
}

stop_process() {
    local pid="$1" label="$2" i=0
    [ -n "$pid" ] || return 0
    if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid" 2>/dev/null || true
        return 0
    fi
    kill -TERM "$pid" 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do
        i=$((i + 1))
        sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
    fi
    wait "$pid" 2>/dev/null || true
    if kill -0 "$pid" 2>/dev/null; then
        CLEANUP_STATUS="failed"
        CLEANUP_ERRORS="$(jq -cn --argjson prior "$CLEANUP_ERRORS" --arg error "$label process $pid survived cleanup" '$prior + [$error]')"
        return 1
    fi
}

stop_pid_file() {
    local pid_file="$1" label="$2" pid
    [ -f "$pid_file" ] || return 0
    pid="$(cat "$pid_file")"
    case "$pid" in
        ''|*[!0-9]*)
            CLEANUP_STATUS="failed"
            CLEANUP_ERRORS="$(jq -cn --argjson prior "$CLEANUP_ERRORS" --arg error "$label pid file was invalid" '$prior + [$error]')"
            return 1
            ;;
    esac
    stop_process "$pid" "$label" || return 1
    rm -f "$pid_file"
}

remove_container() {
    local name="$1"
    [ -n "$name" ] || return 0
    if docker inspect "$name" >/dev/null 2>&1; then
        if ! docker rm -f -v "$name" >/dev/null 2>&1; then
            CLEANUP_STATUS="failed"
            CLEANUP_ERRORS="$(jq -cn --argjson prior "$CLEANUP_ERRORS" --arg error "container $name could not be removed" '$prior + [$error]')"
            return 1
        fi
    fi
    if docker inspect "$name" >/dev/null 2>&1; then
        CLEANUP_STATUS="failed"
        CLEANUP_ERRORS="$(jq -cn --argjson prior "$CLEANUP_ERRORS" --arg error "container $name still exists after removal" '$prior + [$error]')"
        return 1
    fi
}

cleanup() {
    [ "$CLEANED" -eq 0 ] || return 0
    CLEANED=1
    stop_pid_file "$CANDIDATE_SIMULATOR_PID_FILE" candidate-simulator || true
    stop_pid_file "$BASELINE_SIMULATOR_PID_FILE" baseline-simulator || true
    stop_process "$CANDIDATE_PID" candidate || true
    stop_process "$BASELINE_PID" baseline || true
    stop_process "$SCOPED_IDP_PID" scoped-idp || true
    remove_container "$CANDIDATE_NODERED_NAME" || true
    remove_container "$BASELINE_NODERED_NAME" || true
    remove_container "$CANDIDATE_REDIS_NAME" || true
    remove_container "$BASELINE_REDIS_NAME" || true
    remove_container "$BASELINE_PG_NAME" || true
    remove_container "$CANDIDATE_PG_NAME" || true
    rm -rf "$RUNTIME_DIR"
    if [ "$CLEANUP_STATUS" != "passed" ]; then
        printf 'Disposable MCP cleanup failed: %s\n' "$CLEANUP_ERRORS" >&2
        return 1
    fi
}

retain_redacted_logs() {
    local source target
    for source in "${BASELINE_LOG:-}" "${CANDIDATE_LOG:-}"; do
        [ -n "$source" ] && [ -f "$source" ] || continue
        case "$source" in
            *baseline.log) target="$REPORT_DIR/docker-mcp-system-baseline.redacted.log" ;;
            *) target="$REPORT_DIR/docker-mcp-system-candidate.redacted.log" ;;
        esac
        tail -n 160 "$source" \
            | sed -E \
                -e 's/("(password|token|secret|key|salt)"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"<redacted>"/Ig' \
                -e 's/((password|token|secret|key|salt)[^=[:space:]]*=)[^[:space:]]+/\1<redacted>/Ig' \
            >"$target"
        chmod 0600 "$target"
    done
}

finalize_on_exit() {
    local exit_status="$1" report_status="unavailable"
    if [ "$exit_status" -ne 0 ]; then retain_redacted_logs; fi
    cleanup || true
    if [ "$exit_status" -ne 0 ] && [ ! -f "$RESULT_PATH" ]; then
        if [ "$PHASE" = "evaluation" ] || [ "$PHASE" = "cleanup" ]; then
            report_status="failed"
        fi
        jq -n \
            --arg reportKind "$RUN_REPORT_KIND" \
            --arg status "$report_status" \
            --arg phase "$PHASE" \
            --arg cleanupStatus "$CLEANUP_STATUS" \
            --argjson cleanupErrors "$CLEANUP_ERRORS" \
            '{
                schemaVersion: 1,
                reportKind: $reportKind,
                status: $status,
                setupPhase: $phase,
                error: "Disposable MCP smoke did not reach a complete evaluation report.",
                cleanup: {status: $cleanupStatus, errors: $cleanupErrors}
            }' >"$RESULT_PATH"
        chmod 0600 "$RESULT_PATH"
    fi
}

trap 'finalize_on_exit $?' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for command in docker curl jq openssl python3 rsync shasum; do
    command -v "$command" >/dev/null || {
        printf 'Missing prerequisite: %s\n' "$command" >&2
        exit 2
    }
done
[ -x "$NODE_BIN" ] || {
    printf 'Node 24 executable is unavailable at %s\n' "$NODE_BIN" >&2
    exit 2
}
"$NODE_BIN" --version | grep -Eq '^v24\.' || {
    printf 'The system smoke runner requires Node 24.\n' >&2
    exit 2
}
docker info >/dev/null 2>&1 || {
    printf 'Docker daemon is unavailable.\n' >&2
    exit 2
}
for config_path in /etc/fleet-manager/config /etc/fleet-managerrc; do
    if [ -e "$config_path" ]; then
        printf 'Refusing to read host Fleet rc config at %s.\n' "$config_path" >&2
        exit 2
    fi
done
if [ -n "$BASELINE_ARTIFACT_DIR" ]; then
    [ -n "$BASELINE_CONFIGURED_BUILD_COMMIT" ] || {
        printf 'MCP_SYSTEM_BASELINE_EXPECTED_BUILD_COMMIT is required with MCP_SYSTEM_BASELINE_ARTIFACT_DIR.\n' >&2
        exit 2
    }
    [ -d "$BASELINE_ARTIFACT_DIR" ] || {
        printf 'Baseline artifact directory does not exist.\n' >&2
        exit 2
    }
elif [ -n "$BASELINE_CONFIGURED_BUILD_COMMIT" ]; then
    printf 'MCP_SYSTEM_BASELINE_EXPECTED_BUILD_COMMIT requires MCP_SYSTEM_BASELINE_ARTIFACT_DIR.\n' >&2
    exit 2
fi

CANDIDATE_SOURCE_ROOT="$REPO_ROOT"
if [ -n "$BASELINE_ARTIFACT_DIR" ]; then
    BASELINE_SOURCE_ROOT="$(cd "$BASELINE_ARTIFACT_DIR" && pwd)"
    BASELINE_ARTIFACT_KIND="supplied-compiled-artifact"
else
    BASELINE_SOURCE_ROOT="$REPO_ROOT"
    BASELINE_ARTIFACT_KIND="candidate-artifact-copy"
fi
CANDIDATE_RUNTIME="$RUNTIME_DIR/candidate-source"
BASELINE_RUNTIME="$RUNTIME_DIR/baseline-source"
mkdir -p "$RUNTIME_DIR/deploy/nodered"

PHASE="snapshot"
snapshot_source "$CANDIDATE_SOURCE_ROOT" "$CANDIDATE_RUNTIME" candidate
snapshot_source "$BASELINE_SOURCE_ROOT" "$BASELINE_RUNTIME" baseline
cp "$REPO_ROOT/deploy/nodered/settings.js" "$RUNTIME_DIR/deploy/nodered/settings.js"

CANDIDATE_GIT_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
CANDIDATE_BUILD_COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
CANDIDATE_DIRTY=false
[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ] || CANDIDATE_DIRTY=true
if [ -n "$BASELINE_ARTIFACT_DIR" ]; then
    BASELINE_BUILD_COMMIT="$BASELINE_CONFIGURED_BUILD_COMMIT"
else
    BASELINE_BUILD_COMMIT="$CANDIDATE_BUILD_COMMIT"
fi

CANDIDATE_DIST_HASH="$(tree_hash "$CANDIDATE_RUNTIME/backend/dist")"
CANDIDATE_DB_HASH="$(tree_hash "$CANDIDATE_RUNTIME/backend/db")"
CANDIDATE_STATIC_HASH="$(tree_hash "$CANDIDATE_RUNTIME/backend/static")"
CANDIDATE_DOCS_HASH="$(tree_hash "$CANDIDATE_RUNTIME/docs/generated")"
CANDIDATE_RESOURCE_HASH="$(resource_set_hash "$CANDIDATE_RUNTIME")"
CANDIDATE_SOURCE_HASH="$(artifact_hash "$CANDIDATE_RUNTIME")"
BASELINE_DIST_HASH="$(tree_hash "$BASELINE_RUNTIME/backend/dist")"
BASELINE_DB_HASH="$(tree_hash "$BASELINE_RUNTIME/backend/db")"
BASELINE_STATIC_HASH="$(tree_hash "$BASELINE_RUNTIME/backend/static")"
BASELINE_DOCS_HASH="$(tree_hash "$BASELINE_RUNTIME/docs/generated")"
BASELINE_RESOURCE_HASH="$(resource_set_hash "$BASELINE_RUNTIME")"
BASELINE_SOURCE_HASH="$(artifact_hash "$BASELINE_RUNTIME")"
EVAL_ARTIFACT_HASH="$({
    shasum -a 256 \
        "$REPO_ROOT/backend/scripts/mcp-system-smoke.sh" \
        "$REPO_ROOT/backend/scripts/scoped-automation-system.ts" \
        "$REPO_ROOT/backend/scripts/scoped-automation-idp-fixture.ts" \
        "$REPO_ROOT/backend/scripts/mcp-system-eval.ts" \
        "$REPO_ROOT/backend/scripts/mcp-system-eval-lib.ts" \
        "$REPO_ROOT/backend/test/fixtures/mcp-system-eval-scenarios.json"
} | shasum -a 256 | awk '{print $1}')"

if [ "$BASELINE_SOURCE_HASH" = "$CANDIDATE_SOURCE_HASH" ]; then
    RUN_REPORT_KIND="same-build-a-a-real-http-mcp-smoke"
    VALIDATION_KIND="same-build-a-a-system-smoke"
    COMPARISON_SCOPE="same-artifact A/A transport and workflow smoke with distinct process identities; no two-source or performance claim"
else
    RUN_REPORT_KIND="distinct-source-a-b-real-http-mcp-smoke"
    VALIDATION_KIND="distinct-source-a-b-system-smoke"
    COMPARISON_SCOPE="distinct compiled-artifact A/B deterministic workflow comparison; raw latency only, with no performance or model-quality claim"
fi

for target in baseline candidate; do
    mkdir -p \
        "$RUNTIME_DIR/state/$target/cfg/components" \
        "$RUNTIME_DIR/state/$target/cfg/node-red" \
        "$RUNTIME_DIR/state/$target/cfg/registry" \
        "$RUNTIME_DIR/state/$target/cfg/grafana" \
        "$RUNTIME_DIR/state/$target/static" \
        "$RUNTIME_DIR/state/$target/plugins"
    printf '{}\n' >"$RUNTIME_DIR/state/$target/fleet-manager.rc"
done

PG_PASSWORD="$(openssl rand -hex 32)"
JWT_SECRET_VALUE="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
KDF_SALT="$(openssl rand -hex 24)"
INGRESS_PEPPER="$(openssl rand -hex 32)"
RECEIPT_SECRET="$(openssl rand -hex 32)"
CANDIDATE_NODERED_SECRET="$(openssl rand -hex 32)"
BASELINE_NODERED_SECRET="$(openssl rand -hex 32)"
SCOPED_IDP_PORT="$(free_port)"
SCOPED_IDP_SERVICE_TOKEN="$(openssl rand -hex 32)"
(
    cd "$REPO_ROOT/backend"
    exec env FM_SCOPED_IDP_PORT="$SCOPED_IDP_PORT" \
        FM_SCOPED_IDP_SERVICE_TOKEN="$SCOPED_IDP_SERVICE_TOKEN" \
        "$NODE_BIN" --import tsx scripts/scoped-automation-idp-fixture.ts
) >"$RUNTIME_DIR/scoped-idp.log" 2>&1 &
SCOPED_IDP_PID="$!"
wait_for_http "http://127.0.0.1:$SCOPED_IDP_PORT/health/ready" 30
FM_SCOPED_IDP_SERVICE_TOKEN="$SCOPED_IDP_SERVICE_TOKEN" \
    python3 - "$RUNTIME_DIR/state/candidate/fleet-manager.rc" "$SCOPED_IDP_PORT" <<'PY'
import json
import os
import sys

url = 'http://127.0.0.1:' + sys.argv[2]
config = {'oidc': {'backend': {
    'authority': url,
    'apiBaseUrl': url,
    'serviceToken': os.environ['FM_SCOPED_IDP_SERVICE_TOKEN'],
    'authorization': {'type': 'basic', 'clientId': 'fixture-client', 'clientSecret': 'fixture-secret'},
    'discoveryEndpoint': url + '/.well-known/openid-configuration',
    'introspectionEndpoint': url + '/oauth/v2/introspect'
}, 'frontend': {}}}
with open(sys.argv[1], 'w') as stream:
    json.dump(config, stream)
os.chmod(sys.argv[1], 0o600)
PY
NODE_RED_SERVICE_TOKEN="$(
    cd "$REPO_ROOT/backend"
    JWT_SECRET="$JWT_SECRET_VALUE" "$NODE_BIN" --import tsx -e \
        'process.stdout.write(require("./src/modules/user/signers.ts").DefaultSigner.sign("admin"))'
)"

start_postgres() {
    local name="$1"
    docker run -d --rm \
        --name "$name" \
        --label "fm.mcp-system-run=$RUN_ID" \
        -e "POSTGRES_PASSWORD=$PG_PASSWORD" \
        -e POSTGRES_DB=fleet \
        -p 127.0.0.1::5432 \
        --health-cmd 'pg_isready -h 127.0.0.1 -U postgres -d fleet' \
        --health-interval 1s \
        --health-timeout 2s \
        --health-retries 60 \
        timescale/timescaledb:2.30.2-pg18 \
        postgres \
        -c shared_preload_libraries=timescaledb,pg_stat_statements \
        -c pg_stat_statements.max=10000 \
        -c track_io_timing=on \
        -c track_wal_io_timing=on >/dev/null
    wait_for_container "$name"
    docker exec "$name" psql -v ON_ERROR_STOP=1 -U postgres -d fleet \
        -c 'CREATE EXTENSION IF NOT EXISTS timescaledb' \
        -c 'CREATE SCHEMA IF NOT EXISTS migration' >/dev/null
}

PHASE="docker-infrastructure"
start_postgres "$CANDIDATE_PG_NAME"
CANDIDATE_PG_PORT="$(mapped_port "$CANDIDATE_PG_NAME" 5432)"
BASELINE_PG_NAME="${RUN_ID}-baseline-pg"
start_postgres "$BASELINE_PG_NAME"
BASELINE_PG_PORT="$(mapped_port "$BASELINE_PG_NAME" 5432)"
EXECUTION_TOPOLOGY="two isolated disposable TimescaleDB, Redis, and Node-RED dependency sets with two host Node 24 processes"

start_redis() {
    local name="$1"
    docker run -d --rm \
        --name "$name" \
        --label "fm.mcp-system-run=$RUN_ID" \
        -p 127.0.0.1::6379 \
        --health-cmd 'redis-cli ping | grep -q PONG' \
        --health-interval 1s \
        --health-timeout 2s \
        --health-retries 30 \
        redis:7.4.11-alpine \
        redis-server --appendonly no --maxmemory 256mb --maxmemory-policy noeviction >/dev/null
    wait_for_container "$name"
    mapped_port "$name" 6379
}

start_nodered() {
    local name="$1" secret="$2" source_runtime="$3" backend_port="$4" port
    set --
    if [ "$(uname -s)" = Linux ]; then
        set -- --add-host host.docker.internal:host-gateway
    fi
    docker run -d --rm \
        --name "$name" \
        --label "fm.mcp-system-run=$RUN_ID" \
        -e "FM_NODE_RED_PROXY_SECRET=$secret" \
        -e "NODE_RED_CREDENTIAL_SECRET=$secret" \
        -e "FM_BASE_URL=http://host.docker.internal:$backend_port" \
        -e "FM_NODE_RED_SERVICE_TOKEN=$NODE_RED_SERVICE_TOKEN" \
        -e NODE_RED_HTTP_ADMIN_ROOT=/node-red/red \
        -e NODE_RED_HTTP_NODE_ROOT=/node-red/api \
        -v "$RUNTIME_DIR/deploy/nodered/settings.js:/data/settings.js:ro" \
        -v "$source_runtime/packages/node-red-fleet-manager:/data/node_modules/@shelly/fleet-manager-node-red:ro" \
        -p 127.0.0.1::1880 \
        "$@" \
        nodered/node-red:5.0.7-24 \
        --userDir /data --settings /data/settings.js >/dev/null
    port="$(mapped_port "$name" 1880)"
    # auth/login needs only the proxy secret; adminAuth guards /flows.
    wait_for_http \
        "http://127.0.0.1:$port/node-red/red/auth/login" \
        180 \
        "x-fm-node-red-proxy-secret: $secret" || {
        docker logs --tail 80 "$name" >&2 2>/dev/null || true
        return 1
    }
    printf '%s\n' "$port"
}

BASELINE_REDIS_PORT="$(start_redis "$BASELINE_REDIS_NAME")"
CANDIDATE_REDIS_PORT="$(start_redis "$CANDIDATE_REDIS_NAME")"
BASELINE_PORT="$(free_port)"
CANDIDATE_PORT="$(free_port)"
while [ "$CANDIDATE_PORT" = "$BASELINE_PORT" ]; do CANDIDATE_PORT="$(free_port)"; done
BASELINE_NODERED_PORT="$(start_nodered "$BASELINE_NODERED_NAME" "$BASELINE_NODERED_SECRET" "$BASELINE_RUNTIME" "$BASELINE_PORT")"
CANDIDATE_NODERED_PORT="$(start_nodered "$CANDIDATE_NODERED_NAME" "$CANDIDATE_NODERED_SECRET" "$CANDIDATE_RUNTIME" "$CANDIDATE_PORT")"

start_backend() {
    local target="$1" port="$2" log_path="$3" source_runtime="$4"
    local pg_port="$5" redis_port="$6" nodered_port="$7"
    local nodered_secret="$8" dist_hash="$9" build_commit="${10}"
    (
        cd "$source_runtime/backend"
        exec env -i \
            PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
            LANG=C.UTF-8 \
            NODE_ENV=development \
            FM_DEV_MODE=true \
            ZITADEL_CLIENT_PROJECT_ID=fleet-project \
            FM_CLIENT_ORG_ID=default \
            ZITADEL_LIST_PAGE_SIZE=1000 \
            FM_HTTP_PORT="$port" \
            FLEET_MANAGER_PORT="$port" \
            DB_HOST=127.0.0.1 \
            DB_PORT="$pg_port" \
            DB_USER=postgres \
            DB_PASSWORD="$PG_PASSWORD" \
            DB_NAME=fleet \
            FM_REDIS_DISABLED=false \
            FM_REDIS_URL="redis://127.0.0.1:$redis_port" \
            FM_REDIS_KEY_PREFIX="$RUN_ID:$target" \
            FM_AUTHZ_L1_MAX_ENTRIES=10000 \
            FM_AUTHZ_L1_TTL_SECONDS=60 \
            FM_AUTHZ_L2_TTL_SECONDS=300 \
            FM_AUTHZ_REDIS_KEY_PREFIX="$RUN_ID:$target:authz" \
            FM_AUTHZ_PUBSUB_CHANNEL_PREFIX="$RUN_ID:$target:authz:invalidate" \
            FM_AUTHZ_GROUP_DEPTH_MAX=16 \
            FM_AUTHZ_UNUSED_THRESHOLD_DAYS=90 \
            FM_SCOPED_PAT_RETENTION_DAYS=30 \
            FM_SCOPED_PAT_SWEEP_INTERVAL_MS=3600000 \
            FM_HTTP_RATELIMIT_API_DOCS_PER_MIN=1000 \
            FM_MCP_READS_PER_MIN=1000 \
            FM_MCP_WRITES_PER_MIN=1000 \
            JWT_SECRET="$JWT_SECRET_VALUE" \
            FM_SECRET_ENCRYPTION_KEY="$ENCRYPTION_KEY" \
            FM_SECRET_ENCRYPTION_KEY_ID=system-smoke \
            FM_SECRET_KDF_SALT="$KDF_SALT" \
            FM_DEVICE_INGRESS_TOKEN_PEPPER="$INGRESS_PEPPER" \
            FM_NOTIFICATION_RECEIPT_SIGNING_SECRET="$RECEIPT_SECRET" \
            CONFIG_FOLDER="$RUNTIME_DIR/state/$target/cfg" \
            STATIC_FOLDER="$RUNTIME_DIR/state/$target/static" \
            PLUGINS_FOLDER="$RUNTIME_DIR/state/$target/plugins" \
            FM_API_CONTRACT_VERSION=1 \
            FM_UI_CONTRACT_VERSION=1 \
            FM_FRONTEND_ARTIFACT_ID=system-smoke \
            FM_FRONTEND_ARTIFACT_VERSION="$dist_hash" \
            FM_DEPLOYMENT_MODE=oss \
            FM_TOPOLOGY_MODE=single-tenant \
            FM_CLIENT_ID="$target" \
            FM_ENVIRONMENT_ID=disposable-system-test \
            FM_COMPOSE_PROJECT_NAME="$RUN_ID-$target" \
            FM_MANAGED_BY=mcp-system-smoke \
            FM_SAFE_MODE=false \
            FM_BUILD_COMMIT="$build_commit" \
            FM_PUBLIC_BASE_URL="http://127.0.0.1:$port" \
            FM_DEVICE_INGRESS_DEFAULT_ORGANIZATION_ID=default \
            FM_DEVICE_INGRESS_ENFORCEMENT_MODE=enforce_new \
            FM_DEVICE_INGRESS_ALLOW_PLAIN_WS=true \
            FM_NODE_RED_ENABLED=true \
            FM_NODE_RED_PROXY_TARGET="http://127.0.0.1:$nodered_port" \
            FM_NODE_RED_PROXY_SECRET="$nodered_secret" \
            FM_EXIT_ON_FATAL_ERRORS=true \
            "$NODE_BIN" dist/app.js --config "$RUNTIME_DIR/state/$target/fleet-manager.rc"
    ) >"$log_path" 2>&1 &
    STARTED_PID="$!"
}

authenticate() {
    local port="$1" response
    response="$(curl -fsS \
        -H 'content-type: application/json' \
        -X POST "http://127.0.0.1:$port/rpc" \
        --data '{"method":"User.Authenticate","params":{"username":"admin","password":"admin"}}')"
    jq -er '.access_token' <<<"$response"
}

# /mcp accepts only keys issued for MCP, so the dev admin mints an mcp:full key.
mcp_key() {
    local port="$1" session response
    session="$(authenticate "$port")"
    response="$(curl -fsS \
        -H 'content-type: application/json' \
        -H "authorization: Bearer $session" \
        -X POST "http://127.0.0.1:$port/rpc" \
        --data '{"method":"User.CreateScopedPAT","params":{"userId":"admin","boundaryScope":{"all":true},"audience":["mcp:full"],"purpose":"mcp system smoke","expirationDays":1}}')"
    jq -er '.token' <<<"$response"
}

BASELINE_LOG="$RUNTIME_DIR/baseline.log"
CANDIDATE_LOG="$RUNTIME_DIR/candidate.log"
STARTED_PID=""
PHASE="backend-startup"
start_backend baseline "$BASELINE_PORT" "$BASELINE_LOG" "$BASELINE_RUNTIME" "$BASELINE_PG_PORT" "$BASELINE_REDIS_PORT" "$BASELINE_NODERED_PORT" "$BASELINE_NODERED_SECRET" "$BASELINE_DIST_HASH" "$BASELINE_BUILD_COMMIT"
BASELINE_PID="$STARTED_PID"
if ! wait_for_backend "http://127.0.0.1:$BASELINE_PORT/health/ready" "$BASELINE_PID" Baseline 120; then
    exit 2
fi
start_backend candidate "$CANDIDATE_PORT" "$CANDIDATE_LOG" "$CANDIDATE_RUNTIME" "$CANDIDATE_PG_PORT" "$CANDIDATE_REDIS_PORT" "$CANDIDATE_NODERED_PORT" "$CANDIDATE_NODERED_SECRET" "$CANDIDATE_DIST_HASH" "$CANDIDATE_BUILD_COMMIT"
CANDIDATE_PID="$STARTED_PID"
if ! wait_for_backend "http://127.0.0.1:$CANDIDATE_PORT/health/ready" "$CANDIDATE_PID" Candidate 120; then
    exit 2
fi

BASELINE_AUTH_TOKEN="$(mcp_key "$BASELINE_PORT")"
CANDIDATE_AUTH_TOKEN="$(mcp_key "$CANDIDATE_PORT")"
BASELINE_VERSION="$(curl -fsS "http://127.0.0.1:$BASELINE_PORT/version")"
CANDIDATE_VERSION="$(curl -fsS "http://127.0.0.1:$CANDIDATE_PORT/version")"
BASELINE_FINGERPRINT="$(jq -er '.configuration_fingerprint' <<<"$BASELINE_VERSION")"
CANDIDATE_FINGERPRINT="$(jq -er '.configuration_fingerprint' <<<"$CANDIDATE_VERSION")"

PHASE="evaluation"
set +e
(
    cd "$REPO_ROOT/backend"
    env \
        MCP_AB_BASELINE_URL="http://127.0.0.1:$BASELINE_PORT/mcp" \
        MCP_AB_BASELINE_TOKEN="$BASELINE_AUTH_TOKEN" \
        MCP_AB_BASELINE_SOURCE_ID="runtime-sha256:$BASELINE_SOURCE_HASH" \
        MCP_AB_BASELINE_EXPECTED_BUILD_COMMIT="$BASELINE_BUILD_COMMIT" \
        MCP_AB_BASELINE_EXPECTED_CONFIG_FINGERPRINT="$BASELINE_FINGERPRINT" \
        MCP_AB_BASELINE_POLICY_ID=dev-admin-full \
        MCP_AB_BASELINE_CONFIG_ID=host-runtime-baseline \
        MCP_AB_BASELINE_SIMULATOR_ENTRY="$BASELINE_RUNTIME/backend/dist/devSimulation/main.js" \
        MCP_AB_BASELINE_SIMULATOR_WS_URL="ws://127.0.0.1:$BASELINE_PORT/shelly" \
        MCP_AB_BASELINE_SIMULATOR_PID_FILE="$BASELINE_SIMULATOR_PID_FILE" \
        MCP_AB_CANDIDATE_URL="http://127.0.0.1:$CANDIDATE_PORT/mcp" \
        MCP_AB_CANDIDATE_TOKEN="$CANDIDATE_AUTH_TOKEN" \
        MCP_AB_CANDIDATE_SOURCE_ID="runtime-sha256:$CANDIDATE_SOURCE_HASH" \
        MCP_AB_CANDIDATE_EXPECTED_BUILD_COMMIT="$CANDIDATE_BUILD_COMMIT" \
        MCP_AB_CANDIDATE_EXPECTED_CONFIG_FINGERPRINT="$CANDIDATE_FINGERPRINT" \
        MCP_AB_CANDIDATE_POLICY_ID=dev-admin-full \
        MCP_AB_CANDIDATE_CONFIG_ID=host-runtime-candidate \
        MCP_AB_CANDIDATE_SIMULATOR_ENTRY="$CANDIDATE_RUNTIME/backend/dist/devSimulation/main.js" \
        MCP_AB_CANDIDATE_SIMULATOR_WS_URL="ws://127.0.0.1:$CANDIDATE_PORT/shelly" \
        MCP_AB_CANDIDATE_SIMULATOR_PID_FILE="$CANDIDATE_SIMULATOR_PID_FILE" \
        MCP_AB_REPETITIONS="${MCP_AB_REPETITIONS:-2}" \
        MCP_AB_INCLUDE_NODE_RED=1 \
        MCP_AB_CONFIRM_WRITES=1 \
        MCP_AB_OUTPUT="$RAW_RESULT_PATH" \
        "$NODE_BIN" --import tsx scripts/mcp-system-eval.ts
) >/dev/null
EVAL_STATUS=$?
(
    cd "$REPO_ROOT/backend"
    env FM_SCOPED_SYSTEM_BASE_URL="http://127.0.0.1:$CANDIDATE_PORT" \
        FM_SCOPED_SYSTEM_ADMIN_TOKEN="$CANDIDATE_AUTH_TOKEN" \
        FM_SCOPED_SYSTEM_NODE_RED_SERVICE_TOKEN="$NODE_RED_SERVICE_TOKEN" \
        FM_SCOPED_SYSTEM_NODE_RED_URL="http://127.0.0.1:$CANDIDATE_NODERED_PORT/node-red/red" \
        FM_SCOPED_SYSTEM_NODE_RED_PROXY_SECRET="$CANDIDATE_NODERED_SECRET" \
        FM_SCOPED_SYSTEM_SIMULATOR_WS_URL="ws://127.0.0.1:$CANDIDATE_PORT/shelly" \
        FM_SCOPED_SYSTEM_OUTPUT="$SCOPED_RESULT_PATH" \
        FM_SCOPED_SYSTEM_DB_PORT="$CANDIDATE_PG_PORT" \
        FM_SCOPED_SYSTEM_DB_PASSWORD="$PG_PASSWORD" \
        "$NODE_BIN" --import tsx scripts/scoped-automation-system.ts
)
SCOPED_STATUS=$?
if [ "$SCOPED_STATUS" -ne 0 ]; then EVAL_STATUS=1; fi
set -e
unset BASELINE_AUTH_TOKEN CANDIDATE_AUTH_TOKEN NODE_RED_SERVICE_TOKEN

if [ "$EVAL_STATUS" -ne 0 ]; then retain_redacted_logs; fi
PHASE="cleanup"
cleanup || true
trap - INT TERM

if [ ! -f "$RAW_RESULT_PATH" ]; then
    jq -n \
        --arg status failed \
        --arg error 'MCP system evaluator did not produce a report' \
        '{schemaVersion:1,reportKind:"deterministic-real-http-mcp-ab",status:$status,error:$error}' \
        >"$RAW_RESULT_PATH"
    EVAL_STATUS=1
fi

if [ ! -f "$SCOPED_RESULT_PATH" ]; then
    printf '{"status":"failed","error":"Scoped execution report missing"}\n' >"$SCOPED_RESULT_PATH"
fi
jq \
    --slurpfile scoped "$SCOPED_RESULT_PATH" \
    --arg reportKind "$RUN_REPORT_KIND" \
    --arg validationKind "$VALIDATION_KIND" \
    --arg runId "$RUN_ID" \
    --arg candidateGitCommit "$CANDIDATE_GIT_COMMIT" \
    --argjson candidateDirty "$CANDIDATE_DIRTY" \
    --arg baselineArtifactKind "$BASELINE_ARTIFACT_KIND" \
    --arg baselineBuildCommit "$BASELINE_BUILD_COMMIT" \
    --arg baselineSourceSha256 "$BASELINE_SOURCE_HASH" \
    --arg baselineDistSha256 "$BASELINE_DIST_HASH" \
    --arg baselineDbSha256 "$BASELINE_DB_HASH" \
    --arg baselineStaticSha256 "$BASELINE_STATIC_HASH" \
    --arg baselineDocsSha256 "$BASELINE_DOCS_HASH" \
    --arg baselineResourcesSha256 "$BASELINE_RESOURCE_HASH" \
    --arg candidateBuildCommit "$CANDIDATE_BUILD_COMMIT" \
    --arg candidateSourceSha256 "$CANDIDATE_SOURCE_HASH" \
    --arg candidateDistSha256 "$CANDIDATE_DIST_HASH" \
    --arg candidateDbSha256 "$CANDIDATE_DB_HASH" \
    --arg candidateStaticSha256 "$CANDIDATE_STATIC_HASH" \
    --arg candidateDocsSha256 "$CANDIDATE_DOCS_HASH" \
    --arg candidateResourcesSha256 "$CANDIDATE_RESOURCE_HASH" \
    --arg evalSha256 "$EVAL_ARTIFACT_HASH" \
    --arg topology "$EXECUTION_TOPOLOGY" \
    --arg comparisonScope "$COMPARISON_SCOPE" \
    --arg cleanupStatus "$CLEANUP_STATUS" \
    --argjson cleanupErrors "$CLEANUP_ERRORS" \
    '([.runs[]? | select(.target == "candidate")]) as $candidateRuns
    | ([$candidateRuns[] | select(.status != "passed")]) as $candidateFailures
    | . + {
        scopedAutomation: $scoped[0],
        reportKind: $reportKind,
        disposableRuntime: {
            validationKind: $validationKind,
            runId: $runId,
            candidateGitCommit: $candidateGitCommit,
            candidateGitWorktreeDirty: $candidateDirty,
            sources: {
                baseline: {
                    artifactKind: $baselineArtifactKind,
                    expectedBuildCommit: $baselineBuildCommit,
                    runtimeSourceSha256: $baselineSourceSha256,
                    backendDistSha256: $baselineDistSha256,
                    backendDbSha256: $baselineDbSha256,
                    backendStaticSha256: $baselineStaticSha256,
                    generatedDocsSha256: $baselineDocsSha256,
                    mcpResourceSetSha256: $baselineResourcesSha256
                },
                candidate: {
                    artifactKind: "current-repository-compiled-artifact",
                    expectedBuildCommit: $candidateBuildCommit,
                    runtimeSourceSha256: $candidateSourceSha256,
                    backendDistSha256: $candidateDistSha256,
                    backendDbSha256: $candidateDbSha256,
                    backendStaticSha256: $candidateStaticSha256,
                    generatedDocsSha256: $candidateDocsSha256,
                    mcpResourceSetSha256: $candidateResourcesSha256
                }
            },
            evaluatorSha256: $evalSha256,
            executionTopology: $topology,
            comparisonScope: $comparisonScope,
            authentication: "separate real dev-mode User.Authenticate tokens; each target capability records whether its session is tenant, user, and credential bound",
            testTuningOverrides: {
                httpMcpRequestsPerMinute: 1000,
                mcpReadsPerMinute: 1000,
                mcpWritesPerMinute: 1000,
                reason: "allow the deterministic repeated suite to finish inside one minute on disposable targets"
            },
            simulatedDeviceScenario: {
                status: "configured",
                profile: "shelly-1pm-g3",
                ingress: "isolated plain WebSocket /shelly with enforce_new waiting-room admission"
            },
            candidateAcceptance: {
                requirement: "Every configured candidate scenario and repetition must pass.",
                status: (if (($candidateRuns | length) > 0 and ($candidateFailures | length) == 0) then "passed" else "failed" end),
                nonPassingRuns: [$candidateFailures[] | {
                    scenarioId,
                    repetition,
                    status,
                    error
                }]
            },
            cleanup: {status: $cleanupStatus, errors: $cleanupErrors}
        }
    }
    | if (
        .scopedAutomation.status != "passed" or
        .disposableRuntime.cleanup.status != "passed" or
        .disposableRuntime.candidateAcceptance.status != "passed"
    ) then .status = "failed" else . end' \
    "$RAW_RESULT_PATH" >"$RESULT_PATH.tmp"
mv "$RESULT_PATH.tmp" "$RESULT_PATH"
rm -f "$RAW_RESULT_PATH"
chmod 0600 "$RESULT_PATH"

case "$(jq -r '.status' "$RESULT_PATH")" in
    passed) EVAL_STATUS=0 ;;
    failed) EVAL_STATUS=1 ;;
    *) EVAL_STATUS=2 ;;
esac

finalize_on_exit "$EVAL_STATUS"
trap - EXIT
if [ "$CLEANUP_STATUS" != "passed" ]; then
    exit 1
fi
exit "$EVAL_STATUS"
