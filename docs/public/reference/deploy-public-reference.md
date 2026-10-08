<!-- audience: public -->
# `deploy-public.sh` reference, Fleet Management (OSS / community)

Operator reference for `deploy/deploy-public.sh`, the single-tenant, self-hosted
installer for the open-source Fleet Management distribution.

This is the **public** path.

`deploy/deploy-public.sh` is a thin forwarder to the modular implementation
under `deploy/scripts/public/`. The wrapper is frozen, never edit it.

---

## TL;DR

```bash
# First-time install (idempotent, bootstraps deps, sets up SSL, starts FM)
./deploy/deploy-public.sh up

# Local LAN with self-signed HTTPS (default, OIDC PKCE needs secure context)
./deploy/deploy-public.sh up --ssl selfsigned

# Public hostname with Let's Encrypt
./deploy/deploy-public.sh up --ssl --domain fm.example.com --email ops@example.com

# Pull newer images and restart (backup → apply → health → smoke → rollback-on-fail)
./deploy/deploy-public.sh upgrade

# Upgrade with extended health monitoring (auto-rolls-back on post-update degradation)
./deploy/deploy-public.sh upgrade --soak 300

# Upgrade from v1.91.0 or older, running any pending database / Zitadel migration first
./deploy/deploy-public.sh upgrade --migrate-first --yes

# Revert to the image from before the last successful upgrade
./deploy/deploy-public.sh rollback

# Status / logs / access URLs
./deploy/deploy-public.sh status
./deploy/deploy-public.sh logs [service]
./deploy/deploy-public.sh ip

# Stop (keep data) / stop + delete data
./deploy/deploy-public.sh down
./deploy/deploy-public.sh down --volumes
```

---

## Supported platforms

Ubuntu/Debian, Raspberry Pi OS (arm64), Arch Linux, macOS.

### Hardware

| Tier         | RAM | CPU      | Disk      | Devices  |
|--------------|-----|----------|-----------|----------|
| Minimum      | 4GB | 2 cores  | 20GB      | ~50      |
| Recommended  | 8GB | 4 cores  | 64GB SSD  | ~300     |

RPi 4B/5 (8GB) works well, use a USB SSD instead of an SD card for the database.

### Storage (300 devices, default retention)

```text
Docker images:     ~2GB   (one-time)
Device telemetry:  ~500MB (7 day retention, auto-compressed)
Energy meter data: raw readings kept 7 days; the 15-minute rollup is kept
                   with no expiry unless EM_ROLLUP_RETENTION is set
Audit logs:        ~200MB/year (90 day retention)
Zitadel + auth DB: ~500MB
Total first year:  size the energy rollup yourself; it grows without a limit
```

---

## Commands

### Lifecycle

```text
up         Idempotent install / restart. Bootstraps deps on first run.
upgrade    Backup → pull FM → apply → health-gate → smoke → audit → rollback-on-failure
           (with HTTPS on, Traefik is recreated too and the health check goes through it)
migrate    Plan and run staged database / Zitadel migrations (--plan-only, --yes, --dry-run)
update     Backwards-compatible alias for upgrade
rollback   Revert FM to shellygroup/fleet-management:rollback and restore the latest pre-update DB backup
           (--image-only skips the DB restore; --backup PATH picks a dump)
down       Stop Fleet Management (keeps data)
down --volumes      Stop AND delete all data (interactive confirm)
down --volumes --yes   Same, no confirm (CI / scripting)
status     Show service status and health
logs [svc] Tail logs (follow mode)
ip         Show access URLs
help       Print built-in help
```

### Diagnostics / maintenance

```text
doctor [--ssl ...]                        Troubleshoot readiness, deps, and SSL config
rotate-secrets [--all|--jwt|--fm-enc|--postgres] [--graceful|--clear-graceful]
                                          Rotate JWT keypair, FM encryption key, and/or postgres password
backup-db <list|inspect|verify|create|restore>
                                          Fleet DB dumps (pg_dump -Fc) in deploy/state/backups
                                          (see "Database backups" below)
backup-state --age-recipient FILE | --passphrase [--out DIR]
                                          Encrypted tarball of deploy/state/ (creds, keys, certs)
backup-nodered [--label NAME]             Save the Node-RED volume (flows, credentials, context)
restore-nodered --path FILE --yes         Replace the Node-RED volume from a backup, restart Node-RED
seed [--reset] [--no-devices|--with-devices]
                                          Populate demo data
```

---

## Flags

### Global

```text
--debug                Trace shell commands + extra diagnostics
--help / -h            Show help
```

### `up`

```text
--env <name>           Environment override: dev, local, public or cloud-test
                       (default: public, production single-tenant)
                       dev      : admin/admin auth, no Zitadel/SSL, ~60s startup
                       local    : full local Docker stack with Zitadel
                       cloud-test: CI test of the public path
--mdns                 Enable mDNS device discovery
--logging              Start Dozzle log viewer on 127.0.0.1:DOZZLE_PORT (default 9999).
                       Needs DOZZLE_USERS_FILE (absolute path to a Dozzle users.yml)
--nodered              Add Node-RED automations (kept on for later runs)
--no-nodered           Turn Node-RED off (flows stay in the nodered-data volume)
--ssl <mode>           HTTPS mode, REQUIRED for OIDC PKCE in production
                       selfsigned  : auto-generated CA + leaf (LAN, .local, internal hostnames)
                       letsencrypt : ACME via Traefik (public FQDN + port 443; port 80 free, redirect only)
                       custom      : bring your own cert (--cert + --key required)
--domain <hostname>    Domain for Traefik routing + Zitadel external hostname
--cert <path>          TLS cert (--ssl custom)
--key  <path>          TLS private key (--ssl custom)
--email <addr>         Let's Encrypt notification email
```

Default SSL mode is `selfsigned` if `--ssl` is omitted, OIDC PKCE requires a
secure context.

### `upgrade`

```text
--soak <sec>           Post-health-gate soak monitor (default off).
                       Polls FM container health every UPDATE_SOAK_POLL_INTERVAL
                       (default 10s). Triggers full rollback on any degradation.
                       Use 300+ for risky upgrades.
--migrate-first        If a database or Zitadel migration is pending, run it before the upgrade.
                       Without this flag, upgrade refuses to run while migration work is pending.
--yes                  Confirm the migration that --migrate-first runs
--verify-restore <m>   Restore drill before destructive migration steps: auto (default), strict or off
--local                The target image was built on this machine. Set FM_VERSION to its tag.
                       Nothing is pulled. The upgrade stops first if
                       shellygroup/fleet-management:<FM_VERSION> is not on this machine.
--no-backup            Skip the pre-update DB dump (dev-only fast path)
--no-smoke             Skip the post-update smoke probe
--unsafe               Legacy mode: no backup, no rollback, no smoke
```

### `rollback`

```text
--image-only           Start the old image and leave the database as it is
--backup <path>        Restore this dump instead of the latest pre-update backup
```

### `backup-db`

```text
list                   Print the backups as JSON lines
inspect <path>         Print the manifest of one backup
verify <path>          Check the file and its checksum
create [--label NAME]  Make a manual backup (also saves Node-RED when it is on)
restore <path> --yes   Stop Fleet Manager, restore the dump, start it, wait for health
                       (refuses to run without --yes)
```

Dumps go to `deploy/state/backups/`. The database is `fleet`, the user is `postgres`.

### `down`

```text
--volumes              Remove all Docker volumes (DESTRUCTIVE)
--keep-certs           Retain Let's Encrypt certs in named volume across down/up
--yes                  Skip the volume-removal confirmation prompt (CI / scripting)
```

### `rotate-secrets`

```text
--all                  JWT + FM encryption key + postgres (everything)
--jwt                  Zitadel JWT-Profile keypair
--fm-enc               FM application encryption key
--postgres             TimescaleDB superuser password
--graceful             Keep old JWT trusted during a grace window (read-only mode)
--clear-graceful       End the grace window early
```

### `backup-state`

```text
--age-recipient <file> age public key for encryption (recommended)
--passphrase           Symmetric passphrase mode (less safe, interactive prompt)
--out <dir>            Destination directory (default: ./backups)
```

### `backup-nodered` / `restore-nodered`

```text
--label <name>         Archive name part (default: manual)       [backup-nodered]
--path <file>          nodered-*.tar.gz to restore               [restore-nodered]
--yes / --force        Confirm the restore (replaces all flows)  [restore-nodered]
```

### `seed`

```text
--reset                Wipe demo data before re-seeding
--no-devices           Skip the device fixtures
--with-devices         Force device fixtures (default in dev)
```

---

## Environment overrides

Settings that don't have a dedicated flag, set them before running:

```text
FM_VERSION              Fleet Manager image tag (default: latest). Pin it in
                        deploy/env/public.env; FM_VERSION in VERSIONS.env is overridden
FLEET_MANAGER_PORT      FM port (default: 7011)
ZITADEL_EXTERNALPORT    Zitadel port (default: 9090)
POSTGRES_PASSWORD       DB password (default: auto-generated)
FM_HEAP_SIZE            FM Node.js heap size in MB (default: 2048, see deploy/env/public.env)
PG_SHARED_BUFFERS       Postgres shared buffer pool
STATUS_RETENTION        Device telemetry retention window
EM_STATS_RETENTION      Raw energy meter retention (public.env: 7 days; 1 year if empty)
EM_ROLLUP_RETENTION     15-minute energy rollup retention (default: empty = kept forever)
UPDATE_SOAK_POLL_INTERVAL   Soak monitor poll cadence (default 10s)
FM_STARTUP_TIMEOUT      Health-gate timeout (default 180s)
```

The canonical tunable file is `deploy/env/public.env`.

---

## Safety guarantees

Same backbone as the private SaaS path:

1. **Idempotent install**: `up` is safe to re-run; preserves data + re-renders config.
2. **Single-writer lock**: `deploy/state/update.lock` prevents concurrent upgrades.
3. **Manifest validation**: every `upgrade` / `rollback` rejects a corrupt manifest before touching containers; points at `deploy/state/manifest-history/` for recovery.
4. **Atomic manifest writes**: `mktemp` + `rename`; invalid input never overwrites a valid manifest.
5. **Pre-upgrade DB backup**: `pg_dump -Fc` with a `pg_restore --list` check; upgrade aborts if the dump fails.
6. **Health-gate, smoke or audit failure**: `upd_run` auto-reverts to the prior image and (if backup was taken) restores the DB. It does not undo Zitadel, Redis, other images, `deploy/state/` changes or Fleet Manager volumes. Data written after the dump is lost.
7. **`--soak` failure**: same auto-rollback path triggered by post-gate degradation.
8. **`rollback` command**: operator-driven revert to the image tagged at the start of the last `upgrade`, plus a restore of the latest pre-update DB backup (unless `--image-only`).
9. **Secret salt check**: `up`, `upgrade`, `rollback`, `migrate`, `rotate-secrets` and `backup-db restore` refuse to start Fleet Manager when its secret salt does not match the saved one. See below.

---

## Secret salt (`FM_SECRET_KDF_SALT`)

Fleet Manager encrypts the secrets it stores (for example notification
channel secrets and device passwords). The encryption key is made from
`FM_SECRET_ENCRYPTION_KEY` and a salt, `FM_SECRET_KDF_SALT`.

- The installer creates the salt once, on the first run, and saves it in
  `deploy/state/.env`. Do not set it in `deploy/env/public.env`.
- It must never change and must never be lost once Fleet Manager holds data.
  If the salt is different, the stored secrets cannot be decrypted.
  `rotate-secrets` does not change it.
- Before it starts or recreates Fleet Manager, the installer compares three
  values: the saved salt, the salt it was asked to use, and the salt in the
  running container. If one is missing or they differ, it stops and prints
  an error such as:

```text
Public Fleet Manager deployment running, persisted and requested KDF salts do not match. Refusing to restart or recreate it.
Public Fleet Manager deployment has no persisted KDF salt. Refusing to restart or recreate it.
Public Fleet Manager deployment has deployment history but no container from which to verify its KDF salt.
```

- `down` removes the container, which is the proof of the running salt. So a
  clean `down` first checks the salt and saves only a SHA-256 fingerprint of it
  in `deploy/state/kdf-salt-verified.sha256`. The next `up` checks the saved
  salt against that fingerprint. The fingerprint is deleted as soon as a
  container exists again. If `down` could not verify the salt, it warns, and
  `up` refuses to recreate Fleet Manager until the original salt is confirmed.

### If the installer refuses

1. Do not delete the saved salt and do not make a new one. A new salt does not
   repair the problem. It makes every stored secret unreadable.
2. Find the original salt. Restore `deploy/state/` from your most recent
   `backup-state` archive (see "Backup application state" below). The salt is the
   `FM_SECRET_KDF_SALT` line in `deploy/state/.env`. `deploy/state/initial-credentials.txt` also has it.
3. Run the command again.

If the container is still running, it is the best proof of the original salt.
Keep it running until you have the salt in `deploy/state/.env`.

This is why `backup-state` matters: keep a recent archive off this machine.

---

## Common workflows

### First install on a LAN host

```bash
./deploy/deploy-public.sh up                           # default: selfsigned SSL
# OR be explicit:
./deploy/deploy-public.sh up --ssl selfsigned
./deploy/deploy-public.sh ip                           # access URLs
```

### First install with public Let's Encrypt

```bash
./deploy/deploy-public.sh up --ssl --domain fm.example.com --email ops@example.com
```

Requires DNS pointing at the host + port 443 open (TLS-ALPN-01). Port 80 only adds an HTTP to HTTPS redirect and need not be reachable from outside, but Traefik still binds it, so it must be free on the host.

### Local development mode

```bash
./deploy/deploy-public.sh up --env dev          # admin/admin, no Zitadel/SSL
./deploy/deploy-public.sh up --env local        # full Docker stack with Zitadel
```

### Safe upgrade

```bash
# default: backup → pull → apply → health → smoke → rollback-on-failure
./deploy/deploy-public.sh upgrade

# extended monitoring after health-gate passes (auto-rolls-back on degradation)
./deploy/deploy-public.sh upgrade --soak 300
```

### Explicit rollback

```bash
./deploy/deploy-public.sh rollback
```

Requires that a prior `upgrade` ran (it tags
`shellygroup/fleet-management:rollback` at the start). By default `rollback` also restores
the latest pre-update DB backup, so data written after that backup is lost.
Use `--backup PATH` to pick a dump, or `--image-only` to skip the DB restore.
Without a usable backup and without `--image-only`, `rollback` refuses to run.

### Stop / destroy

```bash
./deploy/deploy-public.sh down                          # stop, keep data
./deploy/deploy-public.sh down --volumes                # interactive: stop + DELETE ALL DATA
./deploy/deploy-public.sh down --volumes --yes          # CI: skip confirmation
./deploy/deploy-public.sh down --volumes --keep-certs   # delete data, keep Let's Encrypt certs
```

### Diagnostics

```bash
./deploy/deploy-public.sh status                # service health
./deploy/deploy-public.sh logs                  # tail everything
./deploy/deploy-public.sh logs fleet-manager    # one service
./deploy/deploy-public.sh doctor                # readiness + dep check
./deploy/deploy-public.sh doctor --ssl letsencrypt --domain fm.example.com
```

### Secret rotation

```bash
./deploy/deploy-public.sh rotate-secrets --jwt              # JWT keypair only
./deploy/deploy-public.sh rotate-secrets --all              # JWT + FM enc + postgres
./deploy/deploy-public.sh rotate-secrets --jwt --graceful   # keep old key valid during grace window
./deploy/deploy-public.sh rotate-secrets --clear-graceful   # end grace early
```

### Database backups

```bash
./deploy/deploy-public.sh backup-db create --label before-change
./deploy/deploy-public.sh backup-db list
./deploy/deploy-public.sh backup-db verify deploy/state/backups/<file>.dump
./deploy/deploy-public.sh backup-db restore deploy/state/backups/<file>.dump --yes
```

`create` runs `pg_dump -Fc` on the `fleet` database (user `postgres`) and
writes the dump and a manifest to `deploy/state/backups/`. It deletes no old
dumps. Only a successful `upgrade` keeps the newest 5. `restore` stops Fleet
Manager, replaces the database, starts Fleet Manager and waits for health.

### Backup application state

```bash
# age-encrypted (recommended)
./deploy/deploy-public.sh backup-state --age-recipient ~/.config/age/recipient.txt

# passphrase (less safe)
./deploy/deploy-public.sh backup-state --passphrase

# choose output dir
./deploy/deploy-public.sh backup-state --age-recipient FILE --out /mnt/backups
```

The output tarball contains `deploy/state/`, secrets, keys, certs, manifest history. Store offsite. It always needs `--age-recipient FILE` or `--passphrase`. It leaves out `deploy/state/backups/`, `*.log` and `*.lock` files. Set `BACKUP_PASSPHRASE` to run `--passphrase` without a prompt.

### Backup Node-RED flows

```bash
./deploy/deploy-public.sh backup-nodered --label before-upgrade
./deploy/deploy-public.sh restore-nodered --path deploy/state/backups/nodered/nodered-before-upgrade-<time>.tar.gz --yes
```

The `nodered-data` volume is not part of `deploy/state/`, so `backup-state`
does not hold flows. `backup-nodered` writes the volume (without installed
modules) to `deploy/state/backups/nodered/`, with a checksum manifest, and
keeps the newest 5 (`BACKUP_KEEP`). Node-RED stops for a moment around the
snapshot and around a restore. `backup create` also saves Node-RED when the
add-on is on. Saved flow passwords need `FM_NODE_RED_CREDENTIAL_SECRET` from
`deploy/state/fm-runtime.env`: a restore is refused when that secret differs
from the one at backup time (restore `deploy/state/` first, or set
`NRBK_ALLOW_SECRET_MISMATCH=1` to drop the saved passwords).

---

## Recovery procedures

### Corrupt manifest

```text
[ERROR] manifest is corrupt: deploy/state/manifest.json
        Recover from snapshot in deploy/state/manifest-history/, then retry.
```

```bash
ls -1t deploy/state/manifest-history/ | head
cp deploy/state/manifest-history/rev-NNNN.json deploy/state/manifest.json
./deploy/deploy-public.sh status                # verify
```

### Stale update lock

If a previous `upgrade` was killed (SIGKILL, crash, lost terminal):

```bash
ps -ef | grep "deploy-public.sh" | grep -v grep    # confirm no live runner
rm -f deploy/state/update.lock
```

### Health-gate failure during upgrade

`upd_run` already restored the previous image and (if the backup was taken)
the previous database state. The error message shows the backup path. No
operator action needed unless rollback ALSO failed.

### `--soak` failure

Same auto-rollback as health-gate failure. The script logs `[update] soak
failed at <N>s` and walks the same revert path.

### Explicit `rollback` failure (`No rollback image found`)

You haven't run a successful `upgrade` yet on this host. The
`shellygroup/fleet-management:rollback` tag is created at the start of each `upgrade` from
the currently-running image. Pull an older image manually:

```bash
docker pull shellygroup/fleet-management:<older-tag>
docker tag shellygroup/fleet-management:<older-tag> shellygroup/fleet-management:rollback
./deploy/deploy-public.sh rollback --image-only   # or --backup PATH to also restore a dump
```

---

## Differences from the private (SaaS) path

| Capability                                | Public (`deploy-public.sh`) | Private (`deploy.sh`) |
|-------------------------------------------|:---------------------------:|:---------------------:|
| Single-tenant install                     | yes                         | yes                   |
| Multi-tenant / `--shared`                 | no                           | yes                   |
| Per-tenant `client-*` commands            | no                           | yes                   |
| Pre-upgrade DB backup                     | yes                         | yes                   |
| Manifest-based state                      | yes                         | yes                   |
| Manifest snapshots + recovery dir         | yes                         | yes                   |
| Single-writer update lock                 | yes                         | yes (per-tenant)      |
| Health-gate auto-rollback                 | yes                         | yes                   |
| `--soak` post-gate monitor                | yes                         | yes                   |
| Explicit `rollback`                       | yes                         | yes (per-tenant)      |
| Blue-green parallel deploys               | no                           | yes (per-tenant)      |
| Canary bulk rollout                       | no                           | yes (`--canary`)      |
| `--continue` (halt-vs-continue on fail)   | no                           | yes (bulk)            |
| `--infra` shared-service diff             | no                           | yes                   |
| `rotate-secrets` (Zitadel JWT, FM enc)    | yes                         | yes (different impl)  |
| Encrypted state backup (`backup-state`)   | yes                         | no                     |
| Node-RED volume backup / restore          | yes (`backup-nodered`)      | yes (`backup nodered-create`) |
| Demo data `seed`                          | yes                         | no                     |
| Auto SSL via `up` (no extra command)      | yes                         | yes                   |

Both paths share the same internals: `deploy/scripts/common/manifest.sh`,
`deploy/scripts/common/manifest-record.sh`, `deploy/scripts/common/update.sh`,
`deploy/scripts/common/healthwait.sh`, `deploy/scripts/common/backup.sh`,
`deploy/scripts/common/smoke.sh`. Fixes to safety guarantees land in both
paths simultaneously.

---

## Frozen files (do not edit)

```text
deploy/deploy-public.sh          (forwarder to deploy/scripts/public/deploy-public.sh)
deploy/public/export-manifest.yaml
package.json / package-lock.json
biome.json / tsconfig*.json
vite.config.* / .env*
```
