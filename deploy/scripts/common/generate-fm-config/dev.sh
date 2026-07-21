#!/usr/bin/env bash

generate_dev_config() {
    echo "=== Generating dev-mode config ==="

    local rc_file="$REPO_ROOT/.fleet-managerrc"
    local db_port="${POSTGRES_PORT:-5434}"
    local db_host="${POSTGRES_HOST:-localhost}"
    local db_user="${POSTGRES_USER:-postgres}"
    local db_password="${POSTGRES_PASSWORD:-admin}"
    local db_name="${POSTGRES_DB:-fleet}"
    local fm_port="${FLEET_MANAGER_PORT:-7011}"

    # Migration dirs + linked schemas come from the single source of truth
    # (backend/db/migration/migration-layout.json), the same file the backend
    # reads in migrationLayout.ts — so this generator can never drift from it.
    local layout_file="$REPO_ROOT/backend/db/migration/migration-layout.json"
    if [ ! -f "$layout_file" ]; then
        echo "ERROR: migration layout not found: $layout_file" >&2
        return 1
    fi
    local cwd_json schemas_json
    cwd_json="$(jq -c '.migrationDirs' "$layout_file")" || return 1
    schemas_json="$(jq -c '.linkedSchemas' "$layout_file")" || return 1

    cat > "$rc_file" <<RCEOF
{
  "dev-mode": true,
  "observability": true,
  "internalStorage": {
    "connection": {
      "host": "${db_host}",
      "port": ${db_port},
      "user": "${db_user}",
      "password": "${db_password}",
      "database": "${db_name}",
      "max": 40,
      "connectionTimeoutMillis": 7000,
      "idleTimeoutMillis": 15000,
      "allowExitOnIdle": true
    },
    "schema": "migration",
    "cwd": ${cwd_json},
    "link": {
      "schemas": ${schemas_json}
    }
  },
  "components": {
    "web": {
      "port": ${fm_port},
      "port_ssl": -1,
      "jwt_token": "dev-secret-token-change-in-production",
      "relativeClientPath": "../../../../frontend/dist"
    }
  },
  "logger": {
    "appenders": { "console": { "type": "console" } },
    "categories": { "default": { "appenders": ["console"], "level": "info" } }
  }
}
RCEOF

    echo "  Generated: $rc_file"
    echo "  Dev mode enabled — login with admin/admin"
}
