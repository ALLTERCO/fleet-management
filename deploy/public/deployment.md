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

If prerequisites are missing, `deploy-public.sh up` will run the install flow automatically on supported platforms.

---

## Quick Start

```bash
git clone https://github.com/ALLTERCO/fleet-management.git
cd fleet-management
./deploy/deploy-public.sh up        # installs prerequisites if needed and starts everything
```

On Linux, the first run may prompt for `sudo` so it can install Docker and required tools.
On macOS, the install flow uses Homebrew and Docker Desktop and may trigger Homebrew or macOS permission/setup prompts.
Normal mode prints high-level phases and steps only. Use `./deploy/deploy-public.sh up --debug` to print the full command trace and raw installer output.

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

| Command                  | Description                                                        |
|--------------------------|--------------------------------------------------------------------|
| `up`                     | Start Fleet Management (installs Docker if needed, bootstraps or restarts) |
| `upgrade`                | Pull newer images from registry, then restart                      |
| `down`                   | Stop all services (data preserved)                                 |
| `down --volumes`         | Stop and delete all data (asks for confirmation; `--yes` to skip)  |
| `status`                 | Show service health                                                |
| `logs [service]`         | View logs (optionally for a single service)                        |
| `ip`                     | Show IP and access URLs                                            |
| `doctor`                 | Run diagnostics (see below)                                        |
| `help`                   | Show help (also: `-h`, `--help`)                                   |

### Image pull behavior

| Command     | Cached images | Missing images                         |
|-------------|---------------|----------------------------------------|
| `up`        | Uses as-is    | Compose pulls automatically on startup |
| `upgrade`   | Pulls latest  | Pulls latest                           |

`up` never contacts the Docker registry — it works offline once images are cached.
Use `upgrade` when a new version is available or you want to refresh `:latest` tags.

### Firmware library

The firmware library feature is included in the public build. Public releases do
not ship seeded firmware `.zip` packages; upload firmware packages through Fleet
Manager after deployment.

### Options

| Option                                                     | Description                                                       |
|------------------------------------------------------------|-------------------------------------------------------------------|
| `--ssl selfsigned`                                         | Enable HTTPS with a self-signed certificate                       |
| `--ssl --domain <name>`                                    | Enable HTTPS with Let's Encrypt                                   |
| `--ssl custom --domain <name> --cert <path> --key <path>`  | Enable HTTPS with an existing certificate/key                     |
| `--logging`                                                | Enable Dozzle container log viewer (port 9999)                    |
| `--mdns`                                                   | Enable mDNS device discovery                                      |
| `--debug`                                                  | Print traced shell commands and raw installer / Docker output     |

`doctor` is optional. Use it to troubleshoot readiness before or after deployment. It checks:

1. Docker daemon and Docker Compose availability
2. Required tools (curl, jq, openssl)
3. Docker image availability (checks local cache; warns if missing)
4. Port availability (7011, 9090, 9999 if logging, and 80/443 if SSL)
5. State directory and generated config files
6. SSL certificate status (if SSL mode was used)
7. Network reachability (IP detection and Docker Hub connectivity)
8. Disk space (warns below 20 GB, errors below 10 GB)
9. Running containers and their health status

---

## SSL / HTTPS

### Self-signed certificate (local networks)

```bash
./deploy/deploy-public.sh up --ssl selfsigned
```

Generates a self-signed certificate. Browsers will show a security warning that you can accept. Devices connect via `wss://` instead of `ws://`.

For Shelly outbound WebSocket with self-signed TLS:

1. Upload the Fleet Manager CA certificate (`deploy/state/tls/ca.crt`) via Device Web UI > **Settings > TLS Configuration > Custom CA PEM bundle**
2. In **Outbound WebSocket > Connection type**, select `User TLS`
3. Set **Server** to `wss://<your-hostname-or-ip>/shelly`

`Default TLS` (`ca.pem`) will not work with self-signed certificates — the device's built-in CA bundle only covers public CAs.

### Let's Encrypt (public domains)

```bash
./deploy/deploy-public.sh up --ssl --domain your.domain.com
```

Automatically obtains and renews a certificate from Let's Encrypt via TLS-ALPN-01. Requires:

- Port 443 accessible from the internet (port 80 is optional — used for HTTP→HTTPS redirect)
- DNS A record pointing to your server's public IP

### Custom certificate (public domains)

```bash
./deploy/deploy-public.sh up --ssl custom --domain your.domain.com \
  --cert /path/fullchain.pem --key /path/privkey.pem
```

Uses your existing certificate and private key instead of Let’s Encrypt.

**Custom certificate requirements:**

- `--cert` must be a PEM-encoded fullchain file (leaf certificate followed by any intermediate CA certificates)
- `--key` must be a PEM-encoded private key that matches the certificate
- The certificate must cover the `--domain` value (validated via SAN/CN at deploy time)
- Files are copied into `deploy/state/tls/` — on subsequent `up` runs, previously installed certs are reused automatically if `--cert`/`--key` are omitted

### Container Log Viewer

```bash
./deploy/deploy-public.sh up --logging
```

Adds [Dozzle](https://dozzle.dev), a lightweight, zero-config container log viewer on port 9999. Access it at `http://<your-ip>:9999`. Dozzle is read-only and requires no configuration files — it reads logs directly from the Docker socket.

Can be combined with any other option (e.g., `--ssl selfsigned --logging --mdns`).

---

### Which SSL mode should I use?

- `selfsigned` is for anything that is not publicly issuable by Let’s Encrypt.
- That includes IPv4 addresses, `.local`, split-DNS/internal hostnames, and local domains that only exist inside your network. IPv6 literals are not currently supported.
- `letsencrypt` is only for a real public FQDN that resolves publicly to the server and can pass ACME TLS-ALPN-01 on port `443`.
- `custom` is for “I already have a cert/key I want to use”, including a corporate/internal CA for an internal domain.

### Port and TLS model

All SSL modes terminate TLS at Traefik on port 443. Traefik uses a file-based routing provider (static YAML routes mounted read-only) — it does not require access to the Docker socket. The `--domain` flag accepts a plain hostname, FQDN, or IPv4 address where supported — `host:port` syntax is not supported, and IPv6 literals are not currently supported. Internal services communicate over plain HTTP on the Docker bridge network; TLS is external-facing only.

When `FM_PLAIN_WS=true`, Traefik also listens on port 80 and serves the `/shelly` WebSocket path as plain `ws://` (no TLS, no redirect). This is required for Wall Display devices whose firmware cannot validate non-Allterco certificates. All other port 80 traffic is redirected to HTTPS.

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

### Wall Display Support

| Variable       | Default | Description                                            |
|----------------|---------|--------------------------------------------------------|
| `FM_PLAIN_WS`  | `true`  | Allow plain `ws://` on port 80 for `/shelly`           |

When SSL is enabled, Traefik redirects all HTTP traffic to HTTPS. Wall Display devices cannot validate non-Allterco TLS certificates, so they need plain `ws://` on port 80. Setting `FM_PLAIN_WS=true` adds a high-priority Traefik route that serves `/shelly` on port 80 without redirect. All other HTTP traffic is still redirected to HTTPS.

Set to `false` if you have no Wall Display devices and want to enforce HTTPS-only on all paths.

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
| `EM_STATS_RETENTION`   | `31 days`  | Raw energy retention (long-term = 15-min rollup) |
| `EM_ROLLUP_RETENTION`  | _(empty)_  | 15-min energy rollup retention; empty = kept forever |
| `AUDIT_LOG_RETENTION`  | `90 days`  | Audit log retention                        |

### MCP

Fleet Manager serves `POST /mcp` on the same host and port as the web app. It
does not need another container or exposed port.

Create a scoped access key in Fleet Manager with one MCP level:

- `mcp:read` allows governed reads.
- `mcp:write` adds non-sensitive writes.
- `mcp:full` adds sensitive namespaces, still limited by the user's RBAC.

Optional limits:

| Variable | Default | Description |
|---|---:|---|
| `FM_MCP_ALLOWED_CLIENTS` | empty | Comma-separated allowed `X-MCP-Client` values. Scoped keys also need `mcp-client:<name>` in their audience. |
| `FM_MCP_READS_PER_MIN` | `60` | Read calls allowed per user each minute. |
| `FM_MCP_WRITES_PER_MIN` | `10` | Write calls allowed per user each minute. |
| `FM_MCP_READ_MAX_ROWS` | `200` | Maximum rows returned by one `fm_read`. |
| `FM_MCP_READ_MAX_BYTES` | `262144` | Maximum response size from one `fm_read`. |

See [AI and MCP Operations](./reference/ai-mcp-operations.md) for client setup,
confirmation, auditing, and refusal codes.

### Generated State

On first run, the deploy script generates credentials and OIDC config in `deploy/state/`. Do not edit these manually.

| File                       | Purpose                          |
|----------------------------|----------------------------------|
| `deploy/state/.env`        | Generated passwords and secrets  |
| `deploy/state/zitadel.env` | OIDC client IDs and endpoints    |
| `deploy/state/fm-runtime.env` | Generated Fleet Manager runtime configuration |
| `deploy/state/machinekey/` | Zitadel service account key      |

---

## Architecture

```text
                    ┌─── Traefik (:80/:443) ───┐  (when --ssl)
                    │                           │
Browser ──────────► Fleet Manager (:7011) ────► TimescaleDB
                        │                         (internal)
Shelly ──── ws ─────────┘
devices                  Zitadel (:9090) ── OIDC Auth
                              │
                         Zitadel DB (internal)

Optional:
  Dozzle (:9999)  ── container log viewer (--logging)
  mDNS repeater   ── device discovery (--mdns)
```

### Services

| Service       | Purpose                                        | Port          |
|---------------|------------------------------------------------|---------------|
| Fleet Manager | Web UI + API + WebSocket                       | 7011          |
| TimescaleDB   | PostgreSQL with time-series extensions         | internal only |
| Zitadel       | OIDC identity provider                         | 9090          |
| Zitadel DB    | PostgreSQL backend for Zitadel (internal only) | internal only |
| Dozzle        | Container log viewer (`--logging`)             | 9999          |
| Traefik       | TLS termination and routing (`--ssl`)          | 80 / 443      |

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
3. Enable it and enter:
   - without SSL: `ws://<your-ip>:7011/shelly`
   - with SSL: `wss://<your-hostname-or-ip>/shelly`
4. Choose the TLS mode that matches your deployment:
   - `Default TLS` for publicly trusted certificates
   - `User TLS` for `--ssl selfsigned`, after uploading the Fleet Manager-generated CA certificate from `deploy/state/tls/ca.crt` as the device's custom CA (`user_ca.pem`)

In SSL mode, device WebSocket traffic goes through Traefik on port 443, so do not append `:7011`.

The device will appear in the Fleet Manager waiting room. An admin must approve it before it appears in the dashboard.

### Connecting Wall Display devices

Shelly Wall Display (SAWD) devices connect the same way, but their firmware only trusts the Allterco CA — they reject self-signed, Let's Encrypt, and custom TLS certificates. For SSL deployments:

1. Ensure `FM_PLAIN_WS=true` is set in `deploy/env/public.env` (enabled by default)
2. Ensure port 80 is accessible from the Wall Display
3. Configure the Wall Display's outbound WebSocket to: `ws://<your-ip>/shelly` (port 80, no TLS)

The plain WebSocket path (`/shelly` on port 80) is the **only** HTTP path not redirected to HTTPS when `FM_PLAIN_WS=true`. All browser traffic and other devices still use HTTPS on port 443.

Without SSL, Wall Displays connect normally via `ws://<your-ip>:7011/shelly` — no special configuration needed.

---

## Updating

For normal patch updates, pull newer images and restart:

```bash
./deploy/deploy-public.sh upgrade
```

This runs `docker compose pull` for all configured images, then runs the full `up` flow. If no prior deployment exists, `upgrade` performs a fresh bootstrap automatically.

`up` alone never pulls from the registry — it uses cached images. Use `upgrade` when you want to get newer versions.

### Major upgrades

Some releases change database or identity-provider major versions. Before those
upgrades, print the migration plan:

```bash
./deploy/deploy-public.sh migrate --plan-only
```

If the plan reports required work, run one of:

```bash
./deploy/deploy-public.sh migrate --yes
./deploy/deploy-public.sh upgrade --migrate-first --yes
```

The migration flow creates backups and handles staged database/Zitadel upgrade
steps. A plain `upgrade` refuses to continue when migration work is required.

For the `v1.80.0 -> v1.90.0` upgrade, this matters because Fleet Manager moves
from PostgreSQL 16 based images to PostgreSQL 18 based images, and Zitadel moves
from v2 to v4 through an intermediate v3 stage.

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

`down --volumes` is destructive — it asks for confirmation in interactive terminals. It removes:

- All Docker volumes (database data, ACME certificates)
- The `deploy/state/` directory (generated passwords, OIDC credentials, TLS certificates, machinekey)

Use `--yes` to skip the confirmation prompt (for scripting/CI).

After `down --volumes`, the next `up` performs a fresh bootstrap from scratch.

### Full reset

To start completely fresh:

```bash
./deploy/deploy-public.sh down --volumes
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
./deploy/deploy-public.sh logs zitadel-api
./deploy/deploy-public.sh logs fleet-db
```

### Common issues

**Services fail to start:** Check that ports 7011 and 9090 are not in use by other applications.

**Zitadel bootstrap fails:** Ensure `jq`, `curl`, and `openssl` are installed. Run `deploy-public.sh install` to install missing dependencies.

**Devices don't appear:** Verify the WebSocket URL matches the deployment mode:

- without SSL: `ws://<ip>:7011/shelly`
- with SSL: `wss://<host>/shelly`

For `--ssl selfsigned`, also verify the device is using `User TLS` with the Fleet Manager-generated CA uploaded from `deploy/state/tls/ca.crt` (or the same certificate exported as `ca.pem`). `Default TLS` uses the built-in public CA bundle and will reject the self-signed Fleet Manager certificate.

**Wall Display won't connect with SSL:** Wall Display firmware only trusts the Allterco CA. Ensure `FM_PLAIN_WS=true` in `deploy/env/public.env` and connect via `ws://<your-ip>/shelly` (port 80, no TLS). Verify port 80 is accessible from the device.

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
