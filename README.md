# Fleet Management — Community Edition

Fleet Manager is a self-hosted service for managing fleets of second-generation [Shelly](https://shelly.cloud) devices. Connect your Shelly Plus and Pro series devices via outbound WebSocket and manage them from a single dashboard.

## Quick Start

### Prerequisites

- Linux (Ubuntu/Debian, Raspberry Pi arm64, Arch) or macOS
- 2 GB RAM minimum, 4 GB recommended
- Docker and Docker Compose v2

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

```
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

| Command | Description |
|---------|-------------|
| `./deploy/deploy-public.sh up` | Start Fleet Management |
| `./deploy/deploy-public.sh down` | Stop all services |
| `./deploy/deploy-public.sh down --volumes` | Stop and delete all data |
| `./deploy/deploy-public.sh status` | Show service health |
| `./deploy/deploy-public.sh logs [service]` | View logs |
| `./deploy/deploy-public.sh update` | Pull latest images and restart |
| `./deploy/deploy-public.sh ip` | Show IP and access URLs |
| `./deploy/deploy-public.sh install` | Install Docker + dependencies |

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

```
Browser ──> Fleet Manager (:7011) ──> TimescaleDB (PostgreSQL)
                │
Shelly ─── ws ──┘        Zitadel (:9090) ── OIDC Auth
devices                       │
                         Zitadel DB (PostgreSQL)
```

- **Fleet Manager** — Node.js backend + Vue 3 frontend
- **TimescaleDB** — PostgreSQL with time-series extensions for device data
- **Zitadel** — OIDC identity provider (authentication, user management)

## Configuration

Environment variables can be set before running `deploy-public.sh up`:

| Variable | Default | Description |
|----------|---------|-------------|
| `FM_VERSION` | `latest` | Fleet Manager Docker image version |
| `FLEET_MANAGER_PORT` | `7011` | Fleet Manager HTTP/WebSocket port |
| `ZITADEL_EXTERNALPORT` | `9090` | Zitadel identity provider port |

Credentials are auto-generated on first run and stored in `deploy/state/.env`.

## Optional Features

Enable optional services with `--with`:

```bash
./deploy/deploy-public.sh up --with mdns          # mDNS device discovery
./deploy/deploy-public.sh up --with grafana        # Grafana dashboards
./deploy/deploy-public.sh up --with mailcatcher    # Email testing (dev only)
```

## Example Plugins

Two example plugins are included:

- **greetings** — Simple hello-world plugin demonstrating the plugin API
- **metadata-demo** — Shows how to store and query device metadata

See `plugins/` for source code.

## Documentation

- [RPC and Components](./docs/rpc_and_components.md) — Communication protocols
- [Events](./docs/events.md) — Event system
- [RPC Relay](./docs/rpc_relay.md) — Device command relay
- [Plugins](./docs/plugins.md) — Plugin development guide
- [Developing](./docs/developing.md) — Development setup

## Supported Platforms

| Platform | Architecture | Status |
|----------|-------------|--------|
| Ubuntu 22.04+ | amd64 | Supported |
| Debian 12+ | amd64 | Supported |
| Raspberry Pi OS | arm64 | Supported |
| Arch Linux | amd64 | Supported |
| macOS | amd64/arm64 | Supported (Docker Desktop) |

## License

Apache License 2.0 — see [LICENSE](./LICENSE).

## Contributing

Contributions are welcome via pull requests on GitHub.
