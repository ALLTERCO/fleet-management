# Fleet Management

Fleet Manager is a self-hosted service for managing fleets of Gen2+ [Shelly](https://shelly.com) devices. Connect your Shelly and Pro series devices via outbound WebSocket and manage them from a single dashboard.

## Quick Start

### Prerequisites

- Linux (Ubuntu/Debian, Raspberry Pi arm64, Arch) or macOS
- 4 GB RAM minimum, 8 GB recommended
- Docker and Docker Compose (auto-installed by `deploy-public.sh install`)
- Bash 4.0+ (Linux ships this by default; macOS users need `brew install bash`)

### One-command install

```bash
git clone https://github.com/ALLTERCO/fleet-management.git
cd fleet-management
./deploy/deploy-public.sh install   # installs Docker if needed
./deploy/deploy-public.sh up        # starts everything
```

The installer will:

1. Install Docker and dependencies (if not present)
2. Pull Fleet Manager, TimescaleDB, and Zitadel images
3. Generate secure credentials
4. Bootstrap the OIDC identity provider
5. Start all services

Once ready, you'll see:

```text
  Fleet Manager:   http://<your-ip>:7011
  Zitadel Console: http://<your-ip>:9090

  Default Login:
    Username: fm-admin
    Password: Admin123!
```

### Connect a Shelly device

1. Open the Shelly device's local web page
2. Navigate to **Networks > Outbound WebSocket**
3. Enable it and enter: `ws://<your-ip>:7011/shelly`

The device will appear in the Fleet Manager dashboard.

## Commands

| Command                                    | Description                    |
|--------------------------------------------|--------------------------------|
| `./deploy/deploy-public.sh up`             | Start Fleet Management         |
| `./deploy/deploy-public.sh down`           | Stop all services              |
| `./deploy/deploy-public.sh down --volumes` | Stop and delete all data       |
| `./deploy/deploy-public.sh status`         | Show service health            |
| `./deploy/deploy-public.sh logs [service]` | View logs                      |
| `./deploy/deploy-public.sh update`         | Pull latest images and restart |
| `./deploy/deploy-public.sh ip`             | Show IP and access URLs        |
| `./deploy/deploy-public.sh install`        | Install Docker + dependencies  |

## Docker Hub

Pre-built multi-arch images (amd64 + arm64) are available on Docker Hub:

```bash
docker pull shellygroup/fleet-management:latest
```

## SSL / HTTPS

Self-signed certificate for local networks:

```bash
./deploy/deploy-public.sh up --ssl selfsigned
```

Let's Encrypt certificate for public domains:

```bash
./deploy/deploy-public.sh up --ssl --domain your.domain.com
```

## Architecture

```text
Browser ----> Fleet Manager (:7011) ----> TimescaleDB (PostgreSQL)
                  |
Shelly ---- ws ---+         Zitadel (:9090) --- OIDC Auth
devices                          |
                            Zitadel DB (PostgreSQL)
```

- **Fleet Manager** — Node.js backend + Vue 3 frontend
- **TimescaleDB** — PostgreSQL with time-series extensions for device data
- **Zitadel** — OIDC identity provider (authentication, user management)

## Configuration

All configuration lives in `deploy/env/public.env`. Edit it before running `deploy-public.sh up`:

| Variable               | Default              | Description                                   |
|------------------------|----------------------|-----------------------------------------------|
| `FM_VERSION`           | `latest`             | Fleet Manager Docker image version             |
| `FLEET_MANAGER_PORT`   | `7011`               | Fleet Manager HTTP/WebSocket port              |
| `ZITADEL_EXTERNALPORT` | `9090`               | Zitadel identity provider port                 |
| `ZITADEL_PROJECT_NAME` | `fleet-management`   | OIDC project name in Zitadel                   |
| `FM_ADMIN_USER`        | `fm-admin`           | Default admin username                         |
| `FM_ADMIN_PASSWORD`    | `Admin123!`          | Default admin password                         |
| `FM_ADMIN_EMAIL`       | `admin@fleet.local`  | Default admin email                            |
| `FM_HEAP_SIZE`         | `1024`               | Node.js heap size in MB                        |
| `STATUS_RETENTION`     | `7 days`             | Device telemetry retention period              |
| `AUDIT_LOG_RETENTION`  | `90 days`            | Audit log retention period                     |

Bootstrap settings (`ZITADEL_PROJECT_NAME`, `FM_ADMIN_*`) only apply on first deploy. To change them later, delete `deploy/state/` and re-deploy.

See `deploy/env/public.env` for the full list including database tuning, memory limits, and mDNS settings.

## Optional Features

Enable optional services with `--with`:

```bash
./deploy/deploy-public.sh up --with mdns    # mDNS device discovery
```

## Example Plugins

Two example plugins are included:

- **greetings** — Simple hello-world plugin demonstrating the plugin API
- **metadata-demo** — Shows how to store and query device metadata

See `plugins/` for source code.

## Documentation

- [Deployment Guide](./docs/deployment.md) — Installation, configuration, SSL, troubleshooting
- [API Reference](./docs/api.md) — REST and WebSocket API
- [RPC and Components](./docs/rpc_and_components.md) — Communication protocols
- [Events](./docs/events.md) — Event system
- [RPC Relay](./docs/rpc_relay.md) — Device command relay
- [Entities](./docs/entities.md) — Data model and device entities
- [Custom Permissions](./docs/custom-permissions.md) — Fine-grained access control
- [Zitadel Setup](./docs/ZITADEL_SETUP.md) — Identity provider configuration
- [Plugins](./docs/plugins.md) — Plugin development guide
- [Backups](./docs/backups.md) — Backup and restore procedures
- [Observability](./docs/observability.md) — Monitoring and health checks
- [Developing](./docs/developing.md) — Development setup
- [Codebase](./docs/codebase.md) — Code structure overview

## Supported Platforms

| Platform        | Architecture | Status                          |
|-----------------|--------------|---------------------------------|
| Ubuntu 22.04+   | amd64/arm64  | Supported                       |
| Debian 12+      | amd64/arm64  | Supported                       |
| Raspberry Pi OS | arm64        | Supported                       |
| Arch Linux      | amd64/arm64  | Supported                       |
| macOS           | amd64/arm64  | Supported (Docker Desktop)      |

## License

Apache License 2.0 — see [LICENSE](./LICENSE).

## Contributing

Contributions are welcome via pull requests on GitHub.
