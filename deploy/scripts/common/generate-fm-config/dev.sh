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
    "cwd": [
      "./db/migration/postgresql/logging",
      "./db/migration/postgresql/organization",
      "./db/migration/postgresql/user",
      "./db/migration/postgresql/ui",
      "./db/migration/postgresql/device",
      "./db/migration/postgresql/device/groups",
      "./db/migration/postgresql/device/em",
      "./db/migration/postgresql/notifications"
    ],
    "link": {
      "schemas": ["device", "user", "ui", "organization", "device_em", "logging", "notifications"]
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
