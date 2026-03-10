# Deployment Guide

This guide covers deploying Fleet Management using the `deploy-public.sh` script. All services run in Docker containers.

## Prerequisites

| Requirement      | Version  | Purpose                                     |
|------------------|----------|---------------------------------------------|
| Bash             | 4.0+     | Deploy scripts (macOS: `brew install bash`) |
| Docker           | 20.10+   | Container runtime                           |
| Docker Compose   | v2+      | Service orchestration                       |
| `jq`             | any      | Zitadel bootstrap                           |
| `curl`           | any      | Zitadel bootstrap                           |
| `openssl`        | any      | Zitadel bootstrap (JWT signing)             |

All prerequisites are auto-installed by `deploy-public.sh install` on supported platforms.

---

## Quick Start

```bash
git clone https://github.com/ALLTERCO/fleet-management.git
cd fleet-management
./deploy/deploy-public.sh install   # installs Docker if needed
./deploy/deploy-public.sh up        # starts everything
```

Once ready, you'll see:

```text
  Fleet Manager:   http://<your-ip>:7011
  Zitadel Console: http://<your-ip>:9090

  Default Login:
    Username: fm-admin
    Password: Admin123!
```

---

## CLI Reference

```text
./deploy/deploy-public.sh <command> [options]
```

### Commands

| Command                  | Description                                    |
|--------------------------|------------------------------------------------|
| `install`                | Install Docker and dependencies                |
| `up`                     | Start all services (first run bootstraps auth) |
| `down`                   | Stop all services                              |
| `down --volumes`         | Stop and delete all data                       |
| `status`                 | Show service health                            |
| `logs [service]`         | View logs (optionally for a single service)    |
| `update`                 | Pull latest images and restart                 |
| `ip`                     | Show IP and access URLs                        |

### Options

| Option                   | Description                                    |
|--------------------------|------------------------------------------------|
| `--ssl selfsigned`       | Enable HTTPS with a self-signed certificate    |
| `--ssl --domain <name>`  | Enable HTTPS with Let's Encrypt                |
| `--with mdns`            | Enable mDNS device discovery                   |

---

## SSL / HTTPS

### Self-signed certificate (local networks)

```bash
./deploy/deploy-public.sh up --ssl selfsigned
```

Generates a self-signed certificate. Browsers will show a security warning that you can accept. Devices connect via `wss://` instead of `ws://`.

### Let's Encrypt (public domains)

```bash
./deploy/deploy-public.sh up --ssl --domain your.domain.com
```

Automatically obtains and renews a certificate from Let's Encrypt. Requires:

- Port 80 and 443 accessible from the internet
- DNS A record pointing to your server's public IP

---

## Configuration

All configuration lives in a single file: `deploy/env/public.env`. Edit it before running `deploy-public.sh up`.

### Core Settings

| Variable               | Default              | Description                        |
|------------------------|----------------------|------------------------------------|
| `COMPOSE_PROJECT_NAME` | `fleet-public`       | Docker Compose project name        |
| `FM_VERSION`           | `latest`             | Fleet Manager Docker image version |
| `FLEET_MANAGER_PORT`   | `7011`               | Fleet Manager HTTP/WebSocket port  |
| `ZITADEL_EXTERNALPORT` | `9090`               | Zitadel identity provider port     |
| `ZITADEL_HOSTNAME`     | `auto`               | Hostname for OIDC (auto-detected)  |

### Bootstrap Settings

These configure the OIDC project and admin user created in Zitadel on first deploy. Changing them after bootstrap has no effect — delete `deploy/state/` and re-deploy to apply.

| Variable               | Default              | Description                        |
|------------------------|----------------------|------------------------------------|
| `ZITADEL_PROJECT_NAME` | `fleet-management`   | OIDC project name in Zitadel       |
| `FM_ADMIN_USER`        | `fm-admin`           | Default admin username             |
| `FM_ADMIN_PASSWORD`    | `Admin123!`          | Default admin password             |
| `FM_ADMIN_EMAIL`       | `admin@fleet.local`  | Default admin email                |

### Database Passwords

| Variable                   | Default              | Description                        |
|----------------------------|----------------------|------------------------------------|
| `POSTGRES_PASSWORD`        | `fleet-public-demo`  | TimescaleDB password               |
| `ZITADEL_MASTERKEY`        | (demo key)           | Zitadel encryption master key      |
| `ZITADEL_POSTGRES_PASSWORD`| `fleet-public-demo`  | Zitadel DB password                |
| `ZITADEL_ADMIN_PASSWORD`   | `FleetDemo1234!`     | Zitadel root admin password        |

### Performance Tuning

| Variable               | Default    | Description                                |
|------------------------|------------|--------------------------------------------|
| `FM_HEAP_SIZE`         | `1024`     | Node.js heap size in MB                    |
| `PG_SHARED_BUFFERS`    | `256MB`    | PostgreSQL shared buffers                  |
| `PG_EFFECTIVE_CACHE`   | `512MB`    | PostgreSQL effective cache size            |
| `PG_MAX_CONNECTIONS`   | `100`      | Maximum database connections               |

### Data Retention

| Variable               | Default    | Description                                |
|------------------------|------------|--------------------------------------------|
| `STATUS_RETENTION`     | `7 days`   | Device telemetry retention                 |
| `EM_STATS_RETENTION`   | `1 year`   | Energy meter readings retention            |
| `AUDIT_LOG_RETENTION`  | `90 days`  | Audit log retention                        |

### Generated State

On first run, the deploy script generates credentials and OIDC config in `deploy/state/`. Do not edit these manually.

| File                       | Purpose                          |
|----------------------------|----------------------------------|
| `deploy/state/.env`        | Generated passwords and secrets  |
| `deploy/state/zitadel.env` | OIDC client IDs and endpoints    |
| `deploy/state/fm-oidc.env` | Fleet Manager OIDC configuration |
| `deploy/state/machinekey/` | Zitadel service account key      |

---

## Architecture

```text
Browser ----> Fleet Manager (:7011) ----> TimescaleDB (PostgreSQL)
                  |
Shelly ---- ws ---+         Zitadel (:9090) --- OIDC Auth
devices                          |
                            Zitadel DB (PostgreSQL)
```

### Services

| Service       | Purpose                                        | Port |
|---------------|------------------------------------------------|------|
| Fleet Manager | Web UI + API + WebSocket                       | 7011 |
| TimescaleDB   | PostgreSQL with time-series extensions         | 5434 |
| Zitadel       | OIDC identity provider                         | 9090 |
| Zitadel DB    | PostgreSQL backend for Zitadel (internal only) | ---  |

### Zitadel Bootstrap

On first startup, the deploy script runs an automated bootstrap that:

1. Starts databases (TimescaleDB + Zitadel DB)
2. Starts Zitadel and waits for health check
3. Creates the Fleet Management OIDC project, roles, and applications
4. Creates a default admin user (`fm-admin` / `Admin123!`)
5. Generates OIDC credentials for Fleet Manager
6. Starts Fleet Manager with OIDC config applied

The bootstrap is **idempotent** — safe to run multiple times.

---

## Connecting Devices

1. Open the Shelly device's local web page
2. Navigate to **Networks > Outbound WebSocket**
3. Enable it and enter: `ws://<your-ip>:7011/shelly`
   - Use `wss://` if SSL is enabled

The device will appear in the Fleet Manager waiting room. An admin must approve it before it appears in the dashboard.

---

## Updating

Pull the latest images and restart:

```bash
./deploy/deploy-public.sh update
```

This pulls the newest Fleet Manager image from Docker Hub and restarts the service. Database data is preserved.

---

## Backups

### Database backup

```bash
docker exec fm-fleet-db-1 pg_dump -U fm fleet_manager > backup.sql
```

### Database restore

```bash
docker exec -i fm-fleet-db-1 psql -U fm fleet_manager < backup.sql
```

See [backups.md](./backups.md) for more details.

---

## Stopping and Cleanup

```bash
# Stop containers (keeps data)
./deploy/deploy-public.sh down

# Stop and remove all data (databases, volumes)
./deploy/deploy-public.sh down --volumes
```

**Warning:** `--volumes` is destructive. It deletes all database data and authentication state.

### Full reset

To start completely fresh:

```bash
./deploy/deploy-public.sh down --volumes
rm -rf deploy/state/
./deploy/deploy-public.sh up
```

---

## Troubleshooting

### Check service health

```bash
./deploy/deploy-public.sh status
```

### View logs

```bash
# All services
./deploy/deploy-public.sh logs

# Specific service
./deploy/deploy-public.sh logs fleet-manager
./deploy/deploy-public.sh logs zitadel
./deploy/deploy-public.sh logs fleet-db
```

### Common issues

**Services fail to start:** Check that ports 7011 and 9090 are not in use by other applications.

**Zitadel bootstrap fails:** Ensure `jq`, `curl`, and `openssl` are installed. Run `deploy-public.sh install` to install missing dependencies.

**Devices don't appear:** Verify the WebSocket URL is correct (`ws://<ip>:7011/shelly`) and the device can reach the server on port 7011.

**Login fails after reset:** If you ran `down --volumes` without removing `deploy/state/`, stale credentials may conflict with the fresh database. Remove `deploy/state/` and run `up` again.

---

## Supported Platforms

| Platform        | Architecture | Status                     |
|-----------------|--------------|----------------------------|
| Ubuntu 22.04+   | amd64/arm64  | Supported                  |
| Debian 12+      | amd64/arm64  | Supported                  |
| Raspberry Pi OS | arm64        | Supported                  |
| Arch Linux      | amd64/arm64  | Supported                  |
| macOS           | amd64/arm64  | Supported (Docker Desktop) |
