<!-- audience: public -->
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

`up` always uses HTTPS (except `--env dev`). The default is a self-signed certificate; `--ssl letsencrypt --domain <name>` or `--ssl custom` picks another one, and a first interactive run asks which you want. Once ready, you'll see:

```text
  Fleet Manager:   https://<your-hostname-or-ip>
  Zitadel Console: https://<your-hostname-or-ip>/ui/console

  Login
    FM Admin       fm-admin@<your-hostname-or-ip> / <random password>
    Platform Admin fm-platform-admin@<your-hostname-or-ip> / <random password>
    Zitadel Root   root@<your-hostname-or-ip> / <random password>
```

The installer makes a new random password for each account on the first run. It prints them at the end of `up` and saves them in `deploy/state/initial-credentials.txt` (readable only by its owner). Copy them to your password manager. To read them again later, run `cat deploy/state/initial-credentials.txt`.

The user name is the account name plus the host name, for example `fm-admin@192.168.1.20`.

Ports 7011 and 9090 are published on the host only when SSL is off, which `up` does only with `--env dev`. Dev mode has its own fixed login (see [Dev mode](#dev-mode)). With SSL, everything goes through Traefik on port 443.

---

## CLI Reference

```text
./deploy/deploy-public.sh <command> [options]
```

### Commands

| Command                  | Description                                                        |
|--------------------------|--------------------------------------------------------------------|
| `up`                     | Start Fleet Management (installs Docker if needed, bootstraps or restarts) |
| `upgrade`                | Safe upgrade of Fleet Manager (and Node-RED): backup, swap, health check, smoke test, auto rollback (alias: `update`) |
| `rollback`               | Go back to the image from before the last upgrade and restore the pre-update DB backup (`--image-only` skips the restore, `--backup PATH` picks a dump) |
| `migrate`                | Plan and run database and Zitadel migrations (see [Major upgrades](#major-upgrades)) |
| `backup-db`              | Database backups: `list`, `inspect`, `verify`, `create`, `restore` (see [Backups](#backups)) |
| `backup-state`           | Encrypted copy of `deploy/state/` (see [Backups](#backups))        |
| `rotate-secrets`         | Rotate the JWT key, the Fleet Manager encryption key or the database password |
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
| `upgrade`   | Pulls the Fleet Manager image (and Node-RED when on); after a successful swap also the Zitadel Login UI | Pulls them |
| `upgrade --unsafe` | Pulls every configured image | Pulls them        |

`up` never contacts the Docker registry, it works offline once images are cached.
Use `upgrade` when a new version is available or you want to refresh `:latest` tags.
Plain `upgrade` pulls `fleet-manager` (and `nodered` when it is on), and after a successful swap it also pulls and restarts `zitadel-login`. Only `--unsafe` pulls all images.

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
| `--logging`                                                | Enable authenticated, host-local Dozzle log viewer (port 9999)   |
| `--mdns`                                                   | Enable mDNS device discovery                                      |
| `--nodered`                                                | Add Node-RED automations (see [Node-RED automations](#node-red-automations)) |
| `--no-nodered`                                             | Turn Node-RED off again (flows are kept)                          |
| `--env dev`                                                | Dev server from source for contributors: Node.js 24, `admin` / `admin`, hot reload |
| `--debug`                                                  | Print traced shell commands and raw installer / Docker output     |

### Dev mode

```bash
./deploy/deploy-public.sh up --env dev
```

Dev mode is for people working on the Fleet Manager code. The backend and the
UI run from source with hot reload; only TimescaleDB and Redis run in Docker.
It needs Node.js 24 and npm. Zitadel is not started. The login page shows a
local username and password form with a `DEV MODE` badge. The seeded account is
`admin` / `admin` with full access.

The command stays in the foreground. Press Ctrl+C to stop the dev server; the
database and Redis stop with it, and their data is kept.

Do not use dev mode in production: there is no SSO, no MFA, no password policy,
and it runs over plain HTTP. `--env dev` cannot be combined with `--ssl` or
`--domain`. Dev mode uses the same database volume as `up` in the same folder,
so develop in a separate clone.

`doctor` is optional. Use it to troubleshoot readiness before or after deployment. It checks:

1. Docker daemon and Docker Compose availability
2. Required tools (curl, jq, openssl)
3. Docker image availability (checks local cache; warns if missing)
4. Port availability (80 and 443 with SSL, 7011 and 9090 without SSL, plus 9999 with `--logging`)
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

`Default TLS` (`ca.pem`) will not work with self-signed certificates, the device's built-in CA bundle only covers public CAs.

### Let's Encrypt (public domains)

```bash
./deploy/deploy-public.sh up --ssl --domain your.domain.com
```

Automatically obtains and renews a certificate from Let's Encrypt via TLS-ALPN-01. Requires:

- Port 443 accessible from the internet (port 80 is optional, used for HTTP→HTTPS redirect)
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
- Files are copied into `deploy/state/tls/`, on subsequent `up` runs, previously installed certs are reused automatically if `--cert`/`--key` are omitted

### Container Log Viewer

```bash
DOZZLE_USERS_FILE=/absolute/path/users.yml ./deploy/deploy-public.sh up --logging
```

Adds [Dozzle](https://dozzle.dev) on host-local port 9999 with its simple-auth
provider enabled. Dozzle connects to a dedicated read-only Docker API proxy;
the UI container never receives the host Docker socket.

Generate `users.yml` with Dozzle's `generate` command. The viewer binds to
`127.0.0.1:9999`; use an SSH tunnel rather than opening the port publicly.
It can be combined with any other option (for example `--ssl selfsigned
--logging --mdns`).

### Node-RED automations

```bash
./deploy/deploy-public.sh up --nodered
```

Adds a [Node-RED](https://nodered.org) container with the Fleet Manager
nodes. Open it from Fleet Manager: **Automations > Node-RED**. There is no
extra port and no extra login; Fleet Manager checks your login and passes you
through.

What the installer does:

- Starts `nodered/node-red` at the version pinned by `NODE_RED_VERSION` in
  `deploy/VERSIONS.env`. `upgrade` keeps it on that version.
- Installs the Fleet Manager nodes from the shipped
  `packages/node-red-fleet-manager` folder. They do not come from npm.
- Creates a `fleet-nodered` service account in Zitadel. Flows use its token
  to call Fleet Manager. Node-RED may read devices, groups, places, tags, dashboards and variables, control devices, save variables and send through notification channels. It may not change device settings or create, change or delete groups, places or tags: flows run unattended, so writes stay limited to what the shipped nodes need. Set `FM_NODE_RED_PERMISSIONS` to replace the
  list; `up` and `upgrade` re-apply it.
- Creates two secrets in `deploy/state/`: one that only Fleet Manager uses to
  talk to Node-RED, and one that encrypts the passwords saved in your flows.
- Gives Node-RED only its own secrets (`deploy/state/nodered-runtime.env`).
  People who edit flows cannot read Fleet Manager's other secrets.
- Saves the choice. Later `up`, `upgrade`, `status` and `down` runs keep
  Node-RED on. `up --no-nodered` turns it off; the flows stay in the
  `nodered-data` volume. `WITH_NODERED=true` in the environment works like
  `--nodered`.

`--nodered` cannot be used with `--env dev` (dev mode has no Zitadel).

#### Webhooks

Outside services can start a flow with an HTTP call. Add an
`fm-webhook-in` node (group **Fleet Manager / Triggers**) to a flow. It
makes a random hook id; the **New** button makes a secret and shows it once.
Callers send:

```bash
curl -X POST "https://<your-host>/automation-hooks/<hook id>" \
  -H "x-fm-hook-secret: <secret>" \
  -H "content-type: application/json" \
  -d '{"hello":"world"}'
```

- GET and POST work. Fleet Manager passes the call to Node-RED; the node
  checks the secret.
- Wrong or missing secret: `401`. A node with no secret set: `503`.
- Each call can be up to 256 KB (`FM_NODE_RED_HOOK_BODY_LIMIT_BYTES`), and
  each caller up to 60 calls a minute (`FM_NODE_RED_HOOK_RATE_LIMIT_PER_MIN`).
- `?token=<secret>` works only if you tick **URL token** in the node. Leave it
  off when you can; URLs end up in logs.

#### Security notes

- Node-RED is not published on any host port. Only Fleet Manager reaches it,
  over the internal Docker network, with the private proxy secret. A direct
  call without that secret is refused.
- Node-RED serves one organization: the one it was set up for
  (`FM_NODE_RED_ORG_ID`). Users from other organizations are refused.
- Opening the editor needs the automation permission
  (`FM_NODE_RED_UI_PERMISSIONS`).
- The editor cookie holds a short random session id, not your Fleet Manager
  login. Only the open editor page renews it, once a minute, and only while
  your Fleet Manager login still works. It ends 3 minutes after the last
  renewal (`FM_NODE_RED_SESSION_TTL_MS`) and after 12 hours at most
  (`FM_NODE_RED_SESSION_MAX_AGE_MS`). Log out in Fleet Manager; Node-RED's
  own user menu is hidden. Node-RED only accepts a user Fleet Manager signed,
  and its log names that user for every deploy.
- How fast a removed user loses the editor: logging out, or an admin
  disabling you or changing your roles in Fleet Manager, ends it at once.
  Deactivating, locking or deleting the user, or changing their roles, in the
  Zitadel console ends it within seconds through the webhooks deploy sets up.
  Without those webhooks it takes about 90 seconds (about 6 minutes for a
  role change). A closed or hidden editor ends within 3.5 minutes.
- Anyone who can edit flows can do what the service account can do. Give the
  editor permission only to people you trust with device control.
- Function nodes stop after 30 seconds (`NODE_RED_FUNCTION_TIMEOUT_SECONDS`).
  The container is capped at 512 MB and 1 CPU (`NODE_RED_MEM_LIMIT`,
  `NODE_RED_CPU_LIMIT`). Installing other nodes from the editor is off.
- Treat webhook secrets like passwords. Make a new one in the node if one
  leaks.
- Back up `deploy/state/` (`backup-state`). Without the credential secret,
  passwords saved in flows cannot be read after a restore.

#### Backing up flows

Flows, saved passwords, context and Node-RED settings live in the
`nodered-data` Docker volume, not in `deploy/state/`. Save them with:

```bash
./deploy/deploy-public.sh backup-nodered --label before-upgrade
./deploy/deploy-public.sh restore-nodered --path deploy/state/backups/nodered/nodered-before-upgrade-<time>.tar.gz --yes
```

- `backup-nodered` writes `deploy/state/backups/nodered/nodered-<label>-<time>.tar.gz`
  and a `.manifest.json` with its checksum. Node-RED stops for a moment so its
  context is written to disk, then starts again. The newest 5 are kept
  (`BACKUP_KEEP`). Installed modules are left out; Node-RED reinstalls them.
- `backup create` (same as `backup-db create`) also saves Node-RED when the
  add-on is on.
- `restore-nodered` replaces everything in the volume, then restarts Node-RED.
  It needs `--yes` (`--force` works too).
- Saved passwords are encrypted with the credential secret in
  `deploy/state/fm-runtime.env`. The manifest keeps a fingerprint of it, never
  the secret. A restore is refused when the secret is different: restore
  `deploy/state/` from the same time first (`backup-state`). To restore anyway
  and lose the saved passwords, set `NRBK_ALLOW_SECRET_MISMATCH=1`.

---

### Which SSL mode should I use?

- `selfsigned` is for anything that is not publicly issuable by Let’s Encrypt.
- That includes IPv4 addresses, `.local`, split-DNS/internal hostnames, and local domains that only exist inside your network. IPv6 literals are not currently supported.
- `letsencrypt` is only for a real public FQDN that resolves publicly to the server and can pass ACME TLS-ALPN-01 on port `443`.
- `custom` is for “I already have a cert/key I want to use”, including a corporate/internal CA for an internal domain.

### Port and TLS model

All SSL modes terminate TLS at Traefik on port 443. Traefik uses a file-based routing provider (static YAML routes mounted read-only), it does not require access to the Docker socket. The `--domain` flag accepts a plain hostname, FQDN, or IPv4 address where supported, `host:port` syntax is not supported, and IPv6 literals are not currently supported. Internal services communicate over plain HTTP on the Docker bridge network; TLS is external-facing only.

When `FM_PLAIN_WS=true`, Traefik also listens on port 80 and serves the `/shelly` WebSocket path as plain `ws://` (no TLS, no redirect). This is required for Wall Display devices whose firmware cannot validate non-Allterco certificates. All other port 80 traffic is redirected to HTTPS.

---

## Configuration

Settings live in `deploy/env/public.env`. Edit it before running `deploy-public.sh up`. Passwords and keys are left empty there on purpose: the installer creates them on the first run and saves them in `deploy/state/.env`.

### Core Settings

| Variable               | Default              | Description                        |
|------------------------|----------------------|------------------------------------|
| `COMPOSE_PROJECT_NAME` | `fleet-public`       | Docker Compose project name        |
| `FM_VERSION`           | `latest`             | Fleet Manager Docker image version. To pin a version, set it here. `FM_VERSION` in `deploy/VERSIONS.env` does not pin it: the value from `public.env` is loaded into the shell and wins over `VERSIONS.env`. |
| `FLEET_MANAGER_PORT`   | `7011`               | Fleet Manager HTTP/WebSocket port  |
| `ZITADEL_EXTERNALPORT` | `9090`               | Zitadel identity provider port     |
| `ZITADEL_HOSTNAME`     | `auto`               | Hostname for OIDC (auto-detected)  |

### Bootstrap Settings

These configure the OIDC project and admin user created in Zitadel on first deploy. Changing them after bootstrap has no effect, delete `deploy/state/` and re-deploy to apply.

| Variable               | Default              | Description                        |
|------------------------|----------------------|------------------------------------|
| `ZITADEL_PROJECT_NAME` | `fleet-manager`      | OIDC project name in Zitadel       |
| `FM_ADMIN_USER`        | `fm-admin`           | Admin user name                    |
| `FM_ADMIN_PASSWORD`    | _(empty)_            | Empty = a random password is created and saved |
| `FM_ADMIN_EMAIL`       | `admin@fleet.local`  | Admin email                        |
| `FM_PLATFORM_ADMIN_USER` | `fm-platform-admin` | Platform admin user name          |
| `FM_PLATFORM_ADMIN_PASSWORD` | _(empty)_    | Empty = a random password is created and saved |

### Database Passwords

All of these are empty in `public.env`. The installer creates a random value for each one on the first run and saves it in `deploy/state/.env`. Leave them empty unless you have a reason to set your own.

| Variable                   | Description                        |
|----------------------------|------------------------------------|
| `POSTGRES_PASSWORD`        | TimescaleDB password               |
| `ZITADEL_MASTERKEY`        | Zitadel encryption master key      |
| `ZITADEL_POSTGRES_PASSWORD`| Zitadel DB password                |
| `ZITADEL_ADMIN_PASSWORD`   | Zitadel root admin password        |

`FM_SECRET_KDF_SALT` is also created on the first run. It must never change. See [Secret salt](./public/reference/deploy-public-reference.md#secret-salt-fm_secret_kdf_salt).

### Wall Display Support

| Variable       | Default | Description                                            |
|----------------|---------|--------------------------------------------------------|
| `FM_PLAIN_WS`  | `true`  | Allow plain `ws://` on port 80 for `/shelly`           |

When SSL is enabled, Traefik redirects all HTTP traffic to HTTPS. Wall Display devices cannot validate non-Allterco TLS certificates, so they need plain `ws://` on port 80. Setting `FM_PLAIN_WS=true` adds a high-priority Traefik route that serves `/shelly` on port 80 without redirect. All other HTTP traffic is still redirected to HTTPS.

Set to `false` if you have no Wall Display devices and want to enforce HTTPS-only on all paths.

### Performance Tuning

| Variable               | Default    | Description                                |
|------------------------|------------|--------------------------------------------|
| `FM_HEAP_SIZE`         | `2048`     | Node.js heap size in MB                    |
| `PG_SHARED_BUFFERS`    | `256MB`    | PostgreSQL shared buffers                  |
| `PG_EFFECTIVE_CACHE`   | `512MB`    | PostgreSQL effective cache size            |
| `PG_MAX_CONNECTIONS`   | `100`      | Maximum database connections               |

### Data Retention

| Variable               | Default    | Description                                |
|------------------------|------------|--------------------------------------------|
| `STATUS_RETENTION`     | `7 days`   | Device telemetry retention                 |
| `EM_STATS_RETENTION`   | `7 days`   | Raw energy retention (long-term = 15-min rollup) |
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
| `FM_MCP_READS_PER_MIN` | `600` | Read calls allowed per user each minute. |
| `FM_MCP_WRITES_PER_MIN` | `60` | Write calls allowed per user each minute. |
| `FM_MCP_READ_MAX_ROWS` | `200` | Maximum rows returned by one `fm_read`. |
| `FM_MCP_READ_MAX_BYTES` | `262144` | Maximum response size from one `fm_read`. |

See [AI and MCP Operations](./reference/ai-mcp-operations.md) for client setup,
confirmation, auditing, and refusal codes.

### Generated State

On first run, the deploy script generates credentials and OIDC config in `deploy/state/`. Do not edit these manually.

| File                       | Purpose                          |
|----------------------------|----------------------------------|
| `deploy/state/.env`        | Generated passwords and secrets  |
| `deploy/state/initial-credentials.txt` | The first-run passwords in readable form |
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
  Dozzle (127.0.0.1:9999) ── authenticated log viewer (--logging)
  mDNS repeater   ── device discovery (--mdns)
  Node-RED        ── automations, reached only through Fleet Manager (--nodered)
```

### Services

| Service       | Purpose                                        | Port          |
|---------------|------------------------------------------------|---------------|
| Fleet Manager | Web UI + API + WebSocket                       | 7011          |
| TimescaleDB   | PostgreSQL with time-series extensions         | internal only |
| Zitadel       | OIDC identity provider                         | 9090          |
| Zitadel DB    | PostgreSQL backend for Zitadel (internal only) | internal only |
| Dozzle        | Authenticated host-local log viewer (`--logging`) | 127.0.0.1:9999 |
| Traefik       | TLS termination and routing (`--ssl`)          | 80 / 443      |
| Node-RED      | Automations (`--nodered`)                      | internal only |

### Zitadel Bootstrap

On first startup, the deploy script runs an automated bootstrap that:

1. Starts databases (TimescaleDB + Zitadel DB)
2. Starts Zitadel and waits for health check
3. Creates the Fleet Management OIDC project, roles, and applications
4. Creates the admin users (`fm-admin` and `fm-platform-admin`) with random passwords
5. Generates OIDC credentials for Fleet Manager
6. Starts Fleet Manager with OIDC config applied

The bootstrap is **idempotent**, safe to run multiple times.

---

## Connecting Devices

1. Open the Shelly device's local web page
2. Navigate to **Networks > Outbound WebSocket**
3. Enable it and enter:
   - with SSL (the default): `wss://<your-hostname-or-ip>/shelly`
   - without SSL: `ws://<your-ip>:7011/shelly`
4. Choose the TLS mode that matches your deployment:
   - `Default TLS` for publicly trusted certificates
   - `User TLS` for `--ssl selfsigned`, after uploading the Fleet Manager-generated CA certificate from `deploy/state/tls/ca.crt` as the device's custom CA (`user_ca.pem`)

In SSL mode, device WebSocket traffic goes through Traefik on port 443, so do not append `:7011`.

A device that connects by itself appears in the Fleet Manager waiting room. An admin must approve it before it appears in the dashboard. Devices you add by IP address or network scan are admitted without that step, and so are devices registered through mDNS discovery.

### Connecting Wall Display devices

Shelly Wall Display (SAWD) devices connect the same way, but their firmware only trusts the Allterco CA, they reject self-signed, Let's Encrypt, and custom TLS certificates. For SSL deployments:

1. Ensure `FM_PLAIN_WS=true` is set in `deploy/env/public.env` (enabled by default)
2. Ensure port 80 is accessible from the Wall Display
3. Configure the Wall Display's outbound WebSocket to: `ws://<your-ip>/shelly` (port 80, no TLS)

The plain WebSocket path (`/shelly` on port 80) is the **only** HTTP path not redirected to HTTPS when `FM_PLAIN_WS=true`. All browser traffic and other devices still use HTTPS on port 443.

Without SSL, Wall Displays connect normally via `ws://<your-ip>:7011/shelly`, no special configuration needed.

---

## Updating

For normal updates, run:

```bash
./deploy/deploy-public.sh upgrade        # alias: update
```

`upgrade` runs these steps in order:

1. Checks the secret salt (see [Secret salt](./public/reference/deploy-public-reference.md#secret-salt-fm_secret_kdf_salt)) and checks for pending database or Zitadel migration work (see Major upgrades below).
2. Tags the running image as `shellygroup/fleet-management:rollback`.
3. Takes an update lock (`deploy/state/update.lock`).
4. Checks disk space, then makes a pre-update `pg_dump -Fc` of the `fleet` database. If the dump fails, the upgrade stops before any change.
5. Saves a migration snapshot for the later audit.
6. Pulls and recreates `fleet-manager` (and `nodered` when it is on). With HTTPS on, it also recreates Traefik so it runs the current definition, then writes the routes again once Traefik is healthy.
7. Waits for Fleet Manager to be healthy (`FM_STARTUP_TIMEOUT`, default 180 s). With HTTPS on, the check goes through Traefik at your saved host name. Without HTTPS, it uses `http://localhost:7011`.
8. Runs a smoke test (`/health` reports online).
9. Compares the migration snapshots.
10. Optional soak monitor with `--soak <seconds>`.
11. Keeps the newest 5 dumps.

If step 6, 7, 8, 9 or 10 fails, `upgrade` restores the previous Fleet Manager image and the database dump on its own. This does not undo the Node-RED image, changes to Zitadel, Redis or other images, changes to `deploy/state/`, or Fleet Manager volumes. Data written after the dump was taken is lost.

After a successful upgrade it also restarts the Zitadel Login UI (`zitadel-login`) and updates the TimescaleDB extension. A failure there is reported, but Fleet Manager stays on the new version.

If no prior deployment exists, `upgrade` performs a fresh bootstrap automatically.

`upgrade` options:

| Option | What it does |
|---|---|
| `--migrate-first --yes` | Runs `migrate` first when migration work is pending, then upgrades |
| `--soak <seconds>` | Watches Fleet Manager after the checks pass and rolls back if it degrades |
| `--local` | Uses an image built on this machine and never pulls it. Set `FM_VERSION` to the tag of that image, for example `FM_VERSION=my-build ./deploy/deploy-public.sh upgrade --local`. The upgrade stops before any change if `shellygroup/fleet-management:<tag>` is not on the machine. |
| `--no-backup` | Skips the pre-update dump (development only) |
| `--no-smoke` | Skips the smoke test |
| `--unsafe` | Skips the backup, the smoke test and the rollback. It pulls all configured images, then runs the `up` flow. |

`up` alone never pulls from the registry. It uses cached images. Use `upgrade` when you want to get newer versions.

### Rolling back

```bash
./deploy/deploy-public.sh rollback
```

This needs a successful `upgrade` first, because that is when the old image is tagged. By default it stops Fleet Manager, restores the latest pre-update database backup, starts the old image and waits for it to be healthy. Data written after that backup is lost. If there is no usable backup, it refuses to run.

- `rollback --backup PATH` restores the dump you name instead of the latest one.
- `rollback --image-only` starts the old image and leaves the database as it is. Use it only when you do not want a database restore.

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

To move from v1.91.0 or older to a newer release, run:

```bash
./deploy/deploy-public.sh upgrade --migrate-first --yes
```

If no migration work is pending, this just upgrades. If there is, it runs the migration first and then upgrades.

For the `v1.80.0 -> v1.90.0` upgrade, this matters because Fleet Manager moves
from PostgreSQL 16 based images to PostgreSQL 18 based images, and Zitadel moves
from v2 to v4 through an intermediate v3 stage.

---

## Backups

### Database backup

```bash
./deploy/deploy-public.sh backup-db create --label manual
```

This runs `pg_dump -Fc` on the `fleet` database (user `postgres`) and writes a `.dump` file to `deploy/state/backups/`, with a manifest next to it. It deletes no old dumps; only a successful `upgrade` trims the folder to the newest 5. It also saves Node-RED when the add-on is on.

Other `backup-db` actions:

| Action | What it does |
|---|---|
| `list` | Prints the backups as JSON lines |
| `inspect PATH` | Prints the manifest of one backup |
| `verify PATH` | Checks the file and its checksum |
| `create [--label NAME]` | Makes a new backup |
| `restore PATH --yes` | Restores a backup (see below) |

### Database restore

```bash
./deploy/deploy-public.sh backup-db restore deploy/state/backups/<file>.dump --yes
```

This stops Fleet Manager, restores the database with `pg_restore`, starts Fleet Manager again and waits for health. Without `--yes` it refuses to run.

### Deploy state

`backup-state` saves `deploy/state/` (secrets, keys, certificates) in an encrypted tarball. You must pick one way to encrypt it:

```bash
./deploy/deploy-public.sh backup-state --age-recipient FILE
./deploy/deploy-public.sh backup-state --passphrase
./deploy/deploy-public.sh backup-state --age-recipient FILE --out /mnt/backups
```

`--out DIR` sets the folder for the archive. The default is `./backups`. Keep the archive off this machine. Without `deploy/state/`, the secrets stored in a database backup cannot be decrypted, because the salt and keys for them are kept there. See [Secret salt](./public/reference/deploy-public-reference.md#secret-salt-fm_secret_kdf_salt).

Most container names follow `<COMPOSE_PROJECT_NAME>-<service>-1`. The public default project is `fleet-public`, so the database container is `fleet-public-fleet-db-1`. A few services use a fixed name, for example `fm-redis`.

Node-RED flows: `./deploy/deploy-public.sh backup-nodered` (see
[Backing up flows](#backing-up-flows)).

To back up Shelly device settings (not Fleet itself), see [Device backups](./reference/backups.md).

---

## Stopping and Cleanup

```bash
# Stop containers (keeps data)
./deploy/deploy-public.sh down

# Stop and remove all data (databases, volumes)
./deploy/deploy-public.sh down --volumes
```

`down --volumes` is destructive, it asks for confirmation in interactive terminals. It removes:

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

**Services fail to start:** Check that ports 80 and 443 are free (SSL, the default), or 7011 and 9090 (without SSL).

**Zitadel bootstrap fails:** Ensure `jq`, `curl`, and `openssl` are installed. Run `deploy-public.sh install` to install missing dependencies.

**Devices don't appear:** Verify the WebSocket URL matches the deployment mode:

- without SSL: `ws://<ip>:7011/shelly`
- with SSL: `wss://<host>/shelly`

For `--ssl selfsigned`, also verify the device is using `User TLS` with the Fleet Manager-generated CA uploaded from `deploy/state/tls/ca.crt` (or the same certificate exported as `ca.pem`). `Default TLS` uses the built-in public CA bundle and will reject the self-signed Fleet Manager certificate.

**Wall Display won't connect with SSL:** Wall Display firmware only trusts the Allterco CA. Ensure `FM_PLAIN_WS=true` in `deploy/env/public.env` and connect via `ws://<your-ip>/shelly` (port 80, no TLS). Verify port 80 is accessible from the device.

**Login fails after reset:** If you ran `down --volumes` without removing `deploy/state/`, stale credentials may conflict with the fresh database. Remove `deploy/state/` and run `up` again.

**"Authentication is not configured" on the login page:** The Fleet Manager container is running without Zitadel and without dev mode. This happens when the image is started by hand instead of through `deploy-public.sh`. Run `./deploy/deploy-public.sh up` to set up Zitadel.

**Docker Hub pull rate limit reached:** Docker Hub allows 100 anonymous pulls per IP every 6 hours. A first deploy pulls several images, so a shared or CI address can hit the limit. The Zitadel images come from ghcr.io and do not count toward the Docker Hub limit. The images are fine. Run `docker login` (200 pulls per 6 hours on a free account, unlimited on paid plans), or wait for the window to reset and run the same command again. Images already on the machine are reused. On a network with many hosts, point the Docker daemon at a pull-through cache with `registry-mirrors` in `/etc/docker/daemon.json`.

**Image tag does not exist:** The deploy names the image and tag it could not find, for example `shellygroup/fleet-management:2.0.0`. Fix the matching `*_VERSION` value in `deploy/VERSIONS.env`. For the Fleet Manager tag, set `FM_VERSION` in `deploy/env/public.env` (the value in `VERSIONS.env` is overridden); published tags are listed at https://hub.docker.com/r/shellygroup/fleet-management/tags.

---

## Supported Platforms

| Platform        | Architecture | Status                     |
|-----------------|--------------|----------------------------|
| Ubuntu 22.04+   | amd64/arm64  | Supported                  |
| Debian 12+      | amd64/arm64  | Supported                  |
| Raspberry Pi OS | arm64        | Supported                  |
| Arch Linux      | amd64/arm64  | Supported                  |
| macOS           | amd64/arm64  | Supported (Docker Desktop) |
