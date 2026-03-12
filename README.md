# Fleet Management

[![Docker Pulls](https://img.shields.io/docker/pulls/shellygroup/fleet-management)](https://hub.docker.com/r/shellygroup/fleet-management)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

Fleet Manager is a self-hosted service for managing fleets of
[Shelly](https://shelly.com) Gen2+ (Plus, Pro, Mini) devices
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
   1. Device Web UI > **Settings > User certificate** > upload `deploy/state/tls/ca.crt`
   2. **Outbound WebSocket > SSL Connectivity** > select `user_ca.pem`

   For Let's Encrypt or other publicly trusted certificates, leave SSL Connectivity on `ca.pem` (the device's built-in CA bundle).

The device will appear in the Fleet Manager dashboard.

## Commands

| Command | Description |
| --- | --- |
| `up` | Install prerequisites and start |
| `down` | Stop and keep data |
| `down --volumes` | Stop and delete all data |
| `status` | Show container and health status |
| `logs [service]` | Follow logs |
| `update` | Pull configured image tags and restart |
| `ip` | Show access URLs |
| `doctor` | Troubleshoot configuration |
| `install` | Install Docker manually |

All commands are run via `./deploy/deploy-public.sh <command>`.
If a tag is set to `latest` in `deploy/VERSIONS.env`, `update` will pull the newest image for that tag.
Add `--debug` for raw shell trace and full output.

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
- [API Reference](./docs/api.md)
- [RPC and Components](./docs/rpc_and_components.md)
- [Events](./docs/events.md)
- [RPC Relay](./docs/rpc_relay.md)
- [Entities](./docs/entities.md)
- [Custom Permissions](./docs/custom-permissions.md)
- [Zitadel Setup](./docs/ZITADEL_SETUP.md)
- [Plugins](./docs/plugins.md)
- [Backups](./docs/backups.md)
- [Observability](./docs/observability.md)
- [Developing](./docs/developing.md)
- [Codebase](./docs/codebase.md)

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
