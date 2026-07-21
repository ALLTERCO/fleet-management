# `deploy.sh` reference — Fleet Management (private / SaaS)

Operator reference for `deploy/deploy.sh`. Covers every command, every flag, the
manifest-based lifecycle, and recovery procedures.

For the OSS / community installer, see [deploy-public-reference.md](./deploy-public-reference.md).
For the per-tenant update workflow specifically, see [update-runbook.md](./update-runbook.md).
For the architectural design, see [update-command-design.md](./update-command-design.md).

---

## TL;DR

```bash
# Bootstrap (single-tenant)
deploy.sh up --env <env>

# Bootstrap (multi-tenant SaaS — DB + Zitadel + Traefik, no FM)
deploy.sh up --env <env> --shared

# Add + start a tenant
deploy.sh client-add  <id> --env <env> --shared --domain fm-<id>.example.com
deploy.sh client-up   <id> --env <env> --shared

# Safe per-tenant update (backup → recreate → health-gate → rollback on failure)
deploy.sh client-update <id> --env <env> --shared

# Zero-downtime update (parallel staging + Traefik flip)
deploy.sh client-update <id> --env <env> --shared --blue-green

# Bulk update every tenant
deploy.sh update --env <env> --shared

# Roll back one tenant to fm-<id>:rollback (restores Traefik route + cleans staging)
deploy.sh rollback --env <env> --shared --client <id>

# Snapshot of current deployment state
deploy.sh status --env <env> --shared
```

---

## Environments (`--env`)

Required on every invocation. Determines defaults for routing, SSL, ports, and which env file under `deploy/env/` is sourced.

| Env          | Routing default | FM runtime | Typical use                          |
|--------------|-----------------|------------|--------------------------------------|
| `dev`        | direct          | `npm` (host) | Local development, no Zitadel/SSL  |
| `local`      | direct          | Docker     | Full local stack with Zitadel        |
| `office-test`| direct          | Docker     | Office CI                            |
| `cloud-test` | direct          | Docker     | Cloud CI                             |
| `staging`    | traefik         | Docker     | Pre-prod (requires `--domain`)       |
| `prod`       | traefik         | Docker     | Production (requires `--domain`)     |

---

## Commands

### Lifecycle (deployment-level)

```text
up        Initial deployment — installs the stack (DB + Zitadel + Traefik [+ FM])
build     Build Docker images without starting services (CI pre-build)
down      Stop the deployment (use --volumes to also delete data)
status    Snapshot: containers, health, disk/Docker usage, manifest summary
migrate   Run pending DB migrations only
untrust   Remove the local CA from the host trust store
```

`up` is idempotent — running it again preserves data and re-renders config. In
shared mode it installs only the shared infra; tenants are added separately
via `client-add` + `client-up`.

### Update + rollback (manifest-based)

```text
update    Rebuild & restart Fleet Manager
          In --shared, iterates every tenant in the manifest.
          Per-tenant flags: --client, --canary, --canary-soak, --continue,
                            --infra, --image, --soak, --blue-green

rollback  Per-tenant rollback to the prior image tag (fm-<id>:rollback).
          Requires --client <id>. Restores Traefik route + cleans up any
          orphan blue-green staging container.
```

Bulk update is **serial + halt-on-first-failure** by default. The manifest at
`deploy/state/manifest.json` is the source of truth for what gets updated.

### Per-tenant client commands (shared mode only)

```text
client-add     <id>   Register a tenant in the manifest (requires --domain)
client-up      <id>   Start the tenant's FM container
client-update  <id>   Safe update: backup DB → recreate → health-gate → rollback on failure
client-down    <id>   Stop the tenant (use --volumes to remove data)
client-status  <id>   Show one tenant's container state
client-list           List every registered tenant
clients-status        Health-probe every tenant (/health + version + last update)
client-remove  <id>   Delete a tenant (requires --force)
```

### Test helpers (local validation)

```text
client-test-setup [N]   Create N test tenants with .local.test domains (default: 2)
client-test-verify      Health-check every tenant (container + Traefik)
client-test-cleanup     Remove all test-* tenants
```

### Secret management

```text
rotate-secrets --kind oidc-introspection|service [--dry-run]
               Rotate a Zitadel JWT-Profile keyfile with zero downtime
secrets        Inspect or manage stored secret material
```

---

## Flags (alphabetical)

```text
--canary <id>         Canary-first bulk update (only with --shared, no --client)
--canary-soak <sec>   Soak window between canary success and rolling rest (default 60)
--cert <path>         TLS certificate (--ssl custom only)
--client <id>         Target a single tenant in an otherwise bulk command
--continue            Bulk update: continue past failures (default: halt-on-first)
--debug               Trace shell commands; extra diagnostics
--domain <hostname>   Hostname for Traefik routing + tenant domain
--dry-run             Plan only — no side effects (rotate-secrets)
--email <addr>        Let's Encrypt notification email (--ssl letsencrypt)
--env <name>          Target environment (REQUIRED on every command)
--env-file <path>     Override the auto-selected env file
--force               Confirm a destructive operation (client-remove)
--full                Shorthand for --with grafana --with nodered
--image <ref>         Pin tenant FM image for client-up/client-update/update
--key <path>          TLS private key (--ssl custom only)
--kind <name>         rotate-secrets target (oidc-introspection | service)
--manifest <path>     BM request manifest (--mode bm or client-up)
--mode <fm|bm>        Deployment mode (default: fm)
--name <project>      Docker Compose project name (default: fm)
--no-trust            Skip installing the local CA into host trust store
--routing <mode>      direct | traefik (env-dependent default)
--shared              Multi-tenant SaaS topology
--soak <sec>          Extended post-health soak with auto-rollback on degradation
--ssl <mode>          selfsigned | letsencrypt | custom
--volumes             Remove Docker volumes on down (DESTRUCTIVE)
--with <svc>          Optional service: grafana | mdns | mailcatcher | nodered (mailcatcher is dev-only)
--blue-green          Zero-downtime per-tenant update via parallel staging + Traefik flip
```

Provisioning-only flags used by orchestration pipelines (these surface
template/FM revision metadata into the manifest, normally set by CI):

```text
--template <name>
--template-source <path>
--templates-ref <ref>
--templates-resolved-sha <sha>
--template-manifest-version <ver>
--overrides-hash <sha256>
--overrides-schema-version <ver>
--fm-ref <sha>
--fm-resolved-sha <sha>
```

---

## SSL modes

```text
selfsigned    Auto-generated CA + leaf, host trust-store install (skip with --no-trust).
              Use for LAN, .local names, internal hostnames, IPv4 literals.
letsencrypt   ACME via Traefik. Requires public FQDN + ports 80/443 open.
custom        Bring your own cert. --cert + --key + --domain all required.
```

All modes terminate TLS at Traefik on 443.

---

## Routing modes

```text
direct    FM publishes ports directly. Default for dev/local/office-test/cloud-test.
traefik   Traefik reverse-proxy fronts FM. Default for staging/prod. Requires --domain.
```

---

## Manifest — single source of truth

`deploy/state/manifest.json` is read + written by every install / client-add /
client-update / client-remove / rollback. Every change is snapshotted to
`deploy/state/manifest-history/<rev>.json` first, so rollback can restore prior
state.

Inspect:

```bash
jq . deploy/state/manifest.json           # raw
deploy.sh status --env <env> --shared     # human-readable
```

Sections:

| Field             | Purpose                                                     |
|-------------------|-------------------------------------------------------------|
| `deployment_id`   | Stable UUID, survives re-installs                           |
| `env / mode / ssl_mode / routing / domain` | Install topology               |
| `topology`        | Zitadel SECURE/PORT/SCHEME/HOSTNAME (load-bearing for OIDC) |
| `shared_services` | Current image tag for each shared service                   |
| `clients`         | Per-tenant: image, domain, db_name, redis_user, addons      |
| `history`         | Append-only audit log of every operation                    |

---

## Safety guarantees (post-r0524)

These behaviours are enforced by the code, not by operator discipline:

1. **Per-tenant lock** — `deploy/state/clients/<id>/update.lock` prevents
   concurrent updates on the same tenant. Lock is released even when the
   update fails mid-stream (`|| rc=$?` pattern around `client_update_locked`).
2. **Manifest validation** — every entry point rejects a corrupt manifest
   *before* touching containers. Error points at the recovery dir.
3. **Atomic write** — `manifest_write` writes via `mktemp` + `mv`; invalid
   input never overwrites a valid manifest on disk.
4. **DB backup before every per-tenant update** — backup must pass a
   completion-trailer check; the update aborts if the dump is partial.
5. **Health-gate + optional soak** — failure auto-rolls-back to the prior
   image. Soak failure (post-gate degradation) also auto-rolls-back.
6. **Blue-green failure path** — if step 9 (canonical recreate) fails,
   traffic stays on the healthy staging container. Operator runs
   `deploy.sh rollback --client <id>` to restore canonical *and* flip Traefik
   back (the rollback owns Traefik restoration and staging cleanup).

---

## Common workflows

### Initial bootstrap (single-tenant)

```bash
deploy.sh up --env local --ssl selfsigned --domain fm.local.test
```

### Initial bootstrap (shared SaaS) + first tenant

```bash
deploy.sh up --env prod --shared --domain fm.example.com --ssl letsencrypt --email ops@example.com
deploy.sh client-add acme --env prod --shared --domain fm-acme.example.com
deploy.sh client-up  acme --env prod --shared
```

### Safe per-tenant update

```bash
# default: backup → recreate → health-gate → rollback on failure
deploy.sh client-update acme --env prod --shared

# pin an image
deploy.sh client-update acme --env prod --shared --image registry/fm-acme:v1.2.3

# extended post-health soak (auto-rollback on degradation)
deploy.sh client-update acme --env prod --shared --soak 300

# zero-downtime: spin up staging container, flip Traefik, recreate canonical, flip back
deploy.sh client-update acme --env prod --shared --blue-green
```

### Bulk update (all tenants)

```bash
# halt-on-first-failure (safer default)
deploy.sh update --env prod --shared

# canary acme first, soak 120s, then everyone else
deploy.sh update --env prod --shared --canary acme --canary-soak 120

# pin the same image cluster-wide
deploy.sh update --env prod --shared --image registry/fm:v1.2.3

# don't halt on failure; report at the end
deploy.sh update --env prod --shared --continue
```

### Rollback

```bash
deploy.sh rollback --env prod --shared --client acme
```

Requires that `client-update acme` ran successfully at least once before
(which tags the prior image as `fm-acme:rollback`).

Rollback recreates the canonical container, restores the Traefik route to
the canonical alias, and removes any orphan blue-green staging container.
Rollback does **not** restore the DB — if the new version migrated the
schema, restore from the backup at `deploy/state/backups/<id>/pre-update-*.sql.gz`.

### Shared-infra diff

```bash
deploy.sh update --env prod --shared --infra
```

Reports which shared services (zitadel, postgres, redis, traefik) are
stale vs `VERSIONS.env`. Application path is `deploy.sh up --env prod --shared`
(idempotent). Zitadel and Postgres major versions require manual DB
backups — never auto-recreated.

### Tear-down

```bash
deploy.sh down --env <env>              # stop, keep data
deploy.sh down --env <env> --volumes    # stop + DELETE ALL DATA (no confirm)
deploy.sh client-down <id> --env <env> --shared
deploy.sh client-down <id> --env <env> --shared --volumes
```

---

## Recovery procedures

### Corrupt manifest

Every command at the per-tenant or bulk-update entry point now validates
the manifest before doing anything. On detection:

```text
[ERROR] manifest is corrupt: deploy/state/manifest.json
        Recover from snapshot in deploy/state/manifest-history/, then retry.
```

Recovery:

```bash
ls -1t deploy/state/manifest-history/ | head
cp deploy/state/manifest-history/rev-NNNN.json deploy/state/manifest.json
deploy.sh status --env <env> --shared       # verify
```

### Stale per-tenant lock

If a previous run was killed (SIGKILL, crash, lost terminal) the lock dir
may persist. Clean it once you've confirmed no `deploy.sh` is running on
that tenant:

```bash
ps -ef | grep "client-update <id>" | grep -v grep    # confirm no live runner
rmdir deploy/state/clients/<id>/update.lock
```

### Health-gate failure → auto-rollback already ran

The script tags the prior image as `fm-<id>:rollback` *before* recreating,
so a failed update has already restored the previous container by the time
the error message prints. No operator action needed unless the rollback
itself also fails (rare) — in that case use the DB backup path printed
by the failure message.

### Blue-green step-9 failure → traffic on staging

Operator runs:

```bash
deploy.sh rollback --env <env> --shared --client <id>
```

This recreates the canonical with the rollback image, restores the Traefik
route to the canonical alias, and removes the staging container. Idempotent.

---

## Frozen files (do not edit)

```text
deploy/deploy-public.sh          (forwarder; OSS path — see deploy-public-reference.md)
deploy/public/export-manifest.yaml
package.json / package-lock.json
biome.json / tsconfig*.json
vite.config.* / .env*
```

---

## Related

- [update-runbook.md](./update-runbook.md) — per-tenant update + bulk update workflow
- [update-command-design.md](./update-command-design.md) — architecture + design decisions
- [deploy-public-reference.md](./deploy-public-reference.md) — OSS / community deploy-public.sh
