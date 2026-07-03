# Fleet Management

[![Docker Pulls](https://img.shields.io/docker/pulls/shellygroup/fleet-management)](https://hub.docker.com/r/shellygroup/fleet-management)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

Fleet Manager is a self-hosted service for managing fleets of
[Shelly](https://shelly.com) Gen2+ (Plus, Pro, Mini) and Wall Display devices
via outbound WebSocket from a single dashboard.

- Real-time device monitoring and control
- Device grouping and bulk operations
- Energy metering and consumption tracking
- OTA firmware updates
- Role-based access control (OIDC)
- Plugin system for custom extensions
- WebSocket and HTTP API

## Quick Start

### Prerequisites

- Linux (Ubuntu/Debian, Raspberry Pi arm64, Arch) or macOS
- 4 GB RAM minimum, 8 GB recommended
- Docker and Docker Compose (auto-installed if missing)
- Bash 4.0+ (macOS ships 3.2 — run `brew install bash`)

### One-command bootstrap

```bash
git clone https://github.com/ALLTERCO/fleet-management.git
cd fleet-management
./deploy/deploy-public.sh up
```

Once ready, the script prints access URLs and default credentials.
Default login: `fm-admin` / `Admin123!`.

### Connect a Shelly device

1. Open the Shelly device's local web page
2. Navigate to **Networks > Outbound WebSocket**
3. Enable it and enter:
   - without SSL: `ws://<your-ip>:7011/shelly`
   - with SSL: `wss://<your-hostname-or-ip>/shelly`
4. For self-signed deployments (`--ssl selfsigned`), configure device TLS:
   1. Device Web UI > **Settings > TLS Configuration > Custom CA PEM bundle** > upload `deploy/state/tls/ca.crt`
   2. **Outbound WebSocket > Connection type** > select `User TLS`
   3. **Server** > `wss://<your-hostname-or-ip>/shelly`

   For Let's Encrypt or other publicly trusted certificates, leave SSL Connectivity on `ca.pem` (the device's built-in CA bundle).

The device will appear in the Fleet Manager dashboard.

### Wall Display

Shelly Wall Display devices connect the same way as other Gen2+ devices, but their firmware only trusts the Allterco CA for TLS — they cannot validate self-signed, Let's Encrypt, or custom certificates.

When SSL is enabled, set `FM_PLAIN_WS=true` in `deploy/env/public.env` (enabled by default) to allow plain `ws://` connections on port 80 for the `/shelly` path. All other HTTP traffic is still redirected to HTTPS. Configure the Wall Display to connect to `ws://<your-ip>/shelly` (port 80, no TLS).

## Commands

| Command | Description |
| --- | --- |
| `up` | Start Fleet Management (installs Docker if needed, bootstraps or restarts) |
| `upgrade` | Pull newer images from registry, then restart |
| `migrate --plan-only` | Show required database and Zitadel migration work |
| `migrate --yes` | Run required migration work before upgrading |
| `upgrade-audit` | Check whether the current state is ready to upgrade |
| `backup-db` | Create a database backup |
| `backup-state` | Create a deploy-state backup |
| `down` | Stop and keep data |
| `down --volumes` | Stop and delete all data (asks for confirmation; `--yes` to skip) |
| `status` | Show container and health status |
| `logs [service]` | Follow logs |
| `ip` | Show access URLs |
| `doctor` | Troubleshoot configuration |
| `help` | Show help |

All commands are run via `./deploy/deploy-public.sh <command>`.

**Image pull behavior:** `up` never contacts the registry — it uses cached images
(Compose pulls automatically on first run when no images exist).
`upgrade` pulls all images, then runs `up`. Use `upgrade` when a new version is available.

Add `--debug` for raw shell trace and full output.
Add `--logging` to enable the Dozzle container log viewer on port 9999.

## Updating

Before a major upgrade, make a backup and inspect the migration plan:

```bash
./deploy/deploy-public.sh backup-db
./deploy/deploy-public.sh backup-state
./deploy/deploy-public.sh migrate --plan-only
```

If migration work is required, run:

```bash
./deploy/deploy-public.sh migrate --yes
./deploy/deploy-public.sh upgrade
```

or run both steps together:

```bash
./deploy/deploy-public.sh upgrade --migrate-first --yes
```

The upgrade command refuses to continue when database or Zitadel migration work
is pending. See [Deployment Guide](./docs/deployment.md) for the full upgrade
flow.

## SSL / HTTPS

```bash
# Self-signed (local networks, IPs, .local)
./deploy/deploy-public.sh up --ssl selfsigned

# Let's Encrypt (public FQDN)
./deploy/deploy-public.sh up --ssl --domain your.domain.com

# Your own certificate
./deploy/deploy-public.sh up --ssl custom \
  --domain your.domain.com \
  --cert /path/fullchain.pem \
  --key /path/privkey.pem
```

See the [Deployment Guide](./docs/deployment.md) for SSL mode details,
certificate requirements, and configuration options.

## Docker Hub

Pre-built multi-arch images (amd64 + arm64):

```bash
docker pull shellygroup/fleet-management:latest
```

## Example Plugins

- **greetings** - Hello-world plugin demonstrating the API
- **metadata-demo** - Device metadata storage and querying

See `plugins/` for source code.

## Documentation

- [Deployment Guide](./docs/deployment.md)
- [API Reference](./docs/generated/api.md)
- Runtime OpenAPI document: `https://<your-host>/api/docs/openapi.json`
- [RPC and Components](./docs/reference/rpc_and_components.md)
- [Events](./docs/reference/events.md)
- [RPC Relay](./docs/reference/rpc_relay.md)
- [Entities](./docs/reference/entities.md)
- [Plugins](./docs/reference/plugins.md)
- [Backups](./docs/reference/backups.md)
- [Rollback](./docs/reference/rollback.md)
- [Observability](./docs/reference/observability.md)

## Supported Platforms

| Platform | Architecture | Status |
| --- | --- | --- |
| Ubuntu 22.04+ | amd64/arm64 | Supported |
| Debian 12+ | amd64/arm64 | Supported |
| Raspberry Pi OS | arm64 | Supported |
| Arch Linux | amd64/arm64 | Supported |
| macOS | amd64/arm64 | Supported (Docker Desktop) |

## License

Apache License 2.0 - see [LICENSE](./LICENSE).

## Contributing

Contributions are welcome via pull requests on GitHub.
