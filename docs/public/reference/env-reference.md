<!-- audience: public -->
# Environment Variables Reference

Every variable found in `deploy/env/*.env` files. The env file is the single
source of truth: the deploy script loads it, container entrypoints consume
it, and the frontend gets a runtime-config snapshot via
`deploy/docker/entrypoint.sh`.

## Usage

- **Self-hosted:** set values in `deploy/env/public.env`, then run
  `./deploy/deploy-public.sh up`. Generated secrets are kept in
  `deploy/state/.env`.
- **Never** commit files with real secrets. Replace CHANGEME placeholders
  before use.

Tags: `[REQUIRED]` (the deploy script fails without it), `[OPTIONAL]` (has a
default), `[SENSITIVE]` (treat as secret).

---

## Deployment identity

### `COMPOSE_PROJECT_NAME`

`[OPTIONAL]` Docker Compose prefix on container names
(`{project}-fleet-db-1`). Change to run multiple stacks side-by-side.
Default: `fm`.

---

## TimescaleDB

### `POSTGRES_PASSWORD`

`[REQUIRED]` `[SENSITIVE]` Superuser password for the Postgres instance.

### `PG_SHARED_BUFFERS`

`[OPTIONAL]` Shared memory cache (~25 % of host RAM). Prod `512MB`,
public `256MB`.

### `PG_EFFECTIVE_CACHE`

`[OPTIONAL]` Planner hint for OS-level cache (~50 % of RAM). Prod `1GB`.

### `PG_WORK_MEM`

`[OPTIONAL]` Per-operation working memory. Default `4MB`.

### `PG_MAINT_WORK_MEM`

`[OPTIONAL]` Memory for VACUUM / CREATE INDEX. Prod `128MB`, public `64MB`.

### `PG_MAX_CONNECTIONS`

`[OPTIONAL]` Connection cap. Prod `200`, public `100`.

### `STATUS_RETENTION`

`[OPTIONAL]` Retention for high-frequency device telemetry. Postgres
INTERVAL syntax. Default `7 days`.

### `EM_STATS_RETENTION`

`[OPTIONAL]` Retention for raw energy-meter readings. `public.env` ships
`7 days`; if the setting is empty the installer uses `1 year`. Long-term
history is in the 15-minute rollup.

### `AUDIT_LOG_RETENTION`

`[OPTIONAL]` Retention for user-action audit rows. Default `90 days`.

---

## Zitadel

### `ZITADEL_MASTERKEY`

`[REQUIRED]` `[SENSITIVE]` Secret-encryption key. **Exactly 32 chars.**

### `ZITADEL_POSTGRES_PASSWORD`

`[REQUIRED]` `[SENSITIVE]` Zitadel postgres admin password.

### `ZITADEL_DB_USER_PASSWORD`

`[REQUIRED]` `[SENSITIVE]` Password for the `zitadel` DB role.

### `ZITADEL_ADMIN_PASSWORD`

`[REQUIRED]` `[SENSITIVE]` Admin-console login password.

### `ZITADEL_HOSTNAME`

`[OPTIONAL]` `auto` = detect host IP. Default `auto`.

### `ZITADEL_EXTERNALPORT`

`[OPTIONAL]` External port Zitadel listens on. Default `9090`.

### `ZITADEL_API_HOST_BIND`

`[OPTIONAL]` Host interface for the local-only Zitadel API bind used by deploy
bootstrap and health scripts. Default `127.0.0.1`.

### `ZITADEL_API_HOST_PORT`

`[OPTIONAL]` Host port for the local-only Zitadel API bind used by deploy
bootstrap and health scripts. Default `8080`. Override this when another local
service already owns port 8080.

### `ZITADEL_PROJECT_NAME`

`[OPTIONAL]` Project created at bootstrap. Post-bootstrap changes are
ignored, delete `deploy/state/` to re-bootstrap.

### `ZITADEL_DEFAULT_ORG_NAME`

Default/root Zitadel organization created by first-instance bootstrap. Default
`zitadel`. Post-bootstrap changes require a fresh Zitadel state.

### `FM_PLATFORM_ORG_NAME`

Shelly/provider support org whose configured admins receive hidden provider
support authority. Default `shelly`.

### `FM_CLIENT_ORG_NAME`

Tenant org where the Fleet Manager project/apps and normal tenant admins
live. Default `fleet`.
Generated client env files set this to the client id so clients do not share
the same Zitadel resource-owner org.

### `FM_PLATFORM_ORG_ID`

Generated into Zitadel state from `FM_PLATFORM_ORG_NAME`; backend uses it for
hidden provider support authority. Required in SaaS mode.

### `ZITADEL_DEFAULT_ORG_ID`

Generated into Zitadel state from `ZITADEL_DEFAULT_ORG_NAME`; backend uses it
only for topology-aware auth decisions.

### `ZITADEL_HTTP_TIMEOUT_MS`

`[OPTIONAL]` Per-request timeout for Zitadel Management API calls
(milliseconds). Default `5000`. A hung Zitadel upstream returns
`RpcError.Unavailable` after this elapses instead of pinning the caller.

### `ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS`

`[REQUIRED]` Default expiry (in days) for Zitadel Personal Access Tokens
minted via FM's `User.CreatePAT` RPC when the caller does not pass an
`expirationDays` parameter. Every PAT FM issues carries an
`expirationDate`, there is no non-expiring path. Shipped as `365` in
every `deploy/env/<env>.env` file. Tighten for high-sensitivity
environments (e.g. `90` for prod / SaaS) and re-mint PATs against the
new default. Existing PATs keep their original expiry until rotated.

### `ZITADEL_LIST_PAGE_SIZE`

`[REQUIRED]` Page size FM passes to Zitadel `v2` list endpoints (users,
PATs, grants). Zitadel server-side caps at `1000`; shipped as `1000` in
every env file.

### `FM_ENDPOINT_SECRET_CAS_RETRIES`

`[OPTIONAL]` Compare-and-swap retry budget for OAuth refresh-token writes
on `notifications.channel_secrets`. Default `5`. The store
performs read-modify-write with optimistic concurrency; the loop retries
this many times on a concurrent-writer collision before throwing.

### `FM_MDNS_ENABLED`

`[OPTIONAL]` Start the mDNS responder at boot. Default `false`. Useful
for self-hosted / on-prem deployments where Shelly devices live on the
same L2 network as the FM process.

### `FM_DEVICE_GUI_ENABLED`

`[OPTIONAL]` Enables the same-origin device web GUI proxy. Default `false`.
Enable it only when Fleet Manager can reach device port 80.

### `FM_DEVICE_GUI_SESSION_TTL_SEC`

`[OPTIONAL]` Device GUI session lifetime in seconds. Default `600`, minimum
`60`.

### `FM_DEVICE_GUI_CONNECT_TIMEOUT_MS`

`[OPTIONAL]` Timeout for connecting from Fleet Manager to device port 80.
Default `5000`, minimum `500`.

### `FM_DEVICE_GUI_REQUEST_TIMEOUT_MS`

`[OPTIONAL]` Idle timeout for proxied device HTTP requests after connection.
Default `60000`, minimum `1000`. Native `/rpc` WebSockets use session
revalidation instead.

### `FM_REQUIRE_ALL_PLUGINS`

`[OPTIONAL]` Strict-mode plugin boot. Default `false`, failed plugins
are recorded (`/health.plugins.failedPlugins` + `plugin_init_failures_total`
counter) and boot continues. Set to `true` to abort boot if any plugin
fails to initialize.

### `FM_EXIT_ON_FATAL_ERRORS`

`[OPTIONAL]` Default `true`. On `unhandledRejection` / `uncaughtException`
the process logs, bumps `process_unhandled_rejection_total` /
`process_uncaught_exception_total`, and triggers graceful shutdown with
exit code 1, the orchestrator restarts the container. Set to `false` in
dev for debuggability (counter still bumps; process keeps running).

### `FM_EMDATA_TICK_INTERVAL_MS` / `FM_EMDATA_SYNC_THRESHOLD_MS` / `FM_EMDATA_GRACE_PERIOD_MS`

`[OPTIONAL]` EM data sync timing. All values in milliseconds. Defaults
`1000` / `540000` / `300000`: queue scan once per second, per-device sync
no more often than every 9 minutes, drop the device from the queue after
5 minutes offline. Failed syncs use the same threshold via `lastAttemptTs`
so they cannot busy-loop at the tick rate.

### `FM_EMDATA_PULL_GRACE_MS`

`[OPTIONAL]` Default `120000` (2 minutes). Fleet pulls history from a meter
channel once the time its history is complete up to is older than this.

### `FM_EMSYNC_STREAM_MAX_BYTES` / `FM_EMSYNC_CATCHUP_HIGH_WATER_PCT` / `FM_EMSYNC_PULL_PAUSE_AGE_MS` / `FM_EMSYNC_STREAM_MAXLEN`

`[OPTIONAL]` Meter push buffer in Redis. Defaults `134217728` (128 MiB) /
`75` / `60000` / `2000000`. Records a meter pushes wait here for the
database, one record per entry. The buffer refuses a push that would pass
`FM_EMSYNC_STREAM_MAX_BYTES`; the next history pull fills that minute.
History pulls write to the database directly and pause while the buffer
holds `FM_EMSYNC_CATCHUP_HIGH_WATER_PCT` percent of its bytes or its
oldest entry is older than `FM_EMSYNC_PULL_PAUSE_AGE_MS`. Redis uses about
1.3 times the counted bytes, so keep the budget well below
`REDIS_MAX_MEMORY`. `FM_EMSYNC_STREAM_MAXLEN` is an entry count backstop
only.

### `FM_EMSYNC_PULL_PAGES_PER_CONNECTION` / `FM_EMSYNC_PUSH_BATCH_MS` / `FM_EMSYNC_PUSH_BATCH_MAX_ENTRIES`

`[OPTIONAL]` Defaults `2` / `100` / `500`. A history pull asks a meter for a
page only when it fits: at most `FM_EMSYNC_PULL_PAGES_PER_CONNECTION` pages
per em-sync database connection are fetched or being saved. Pushed records
share one Redis call per `FM_EMSYNC_PUSH_BATCH_MS` window, or per
`FM_EMSYNC_PUSH_BATCH_MAX_ENTRIES` records when that comes first; each push
is still kept or refused whole.

### `FM_EM_COMPLETENESS_INTERVAL_MS` / `FM_EM_COMPLETENESS_SETTLE_MS` / `FM_EM_COMPLETENESS_MAX_SPAN_MS`

`[OPTIONAL]` Meter history completeness check. Defaults `3600000` / `1800000` /
`86400000`: the check runs once an hour, holes younger than 30 minutes are
left to the gap fill, and at most 24 hours are scanned per channel per run.
Ranges the check cannot fill are marked incomplete and shown in reports and
billing.

### `FM_EM_COUNTER_CHECK_LOOKBACK_MS` / `FM_EM_COUNTER_CHECK_TOLERANCE_PCT`

`[OPTIONAL]` Counter check inside the completeness check. Defaults `86400000`
(24 hours) / `2` (percent). Counter points in the window are compared with the
stored energy. A larger gap than the tolerance marks the range incomplete.

### `FM_EM_ROLLUP_CLOSE_GRACE_MS` / `FM_EM_ROLLUP_LATE_DEBOUNCE_MS`

`[OPTIONAL]` Defaults `180000` (3 minutes) / `30000` (30 seconds), range `0`
to `3600000`. A 15-minute bucket of meter records is computed once, as soon as
the records reach its end, or at the latest the grace after its end. A late
record makes its bucket be computed again after the debounce. See
[tuning](tuning.md#fm_em_rollup_close_grace_ms-and-fm_em_rollup_late_debounce_ms).

### `FM_EM_LIVE_DEBUG_HOURS`

`[OPTIONAL]` Default `4`, range `1` to `24`. How long a live EM debug capture
started with `Device.SetEmLiveDebug` runs. The captured values sit in their
own table; when the capture ends they are deleted.

### `FM_HTTP_BREAKER_THRESHOLD` / `FM_HTTP_BREAKER_WINDOW_MS` / `FM_HTTP_BREAKER_COOLDOWN_MS` / `FM_HTTP_BREAKER_MAX_HOSTS`

`[OPTIONAL]` Per-host circuit breaker for outbound webhooks
(`postJsonWithTimeout`). Defaults `5` / `30000` / `60000` / `1024`: open
after 5 failures within 30s, allow one probe after a 60s cooldown,
LRU-bound per-host state at 1024 hosts. 5xx + network errors count as
failures; 4xx is caller-owned and does not trip the breaker.

### `FM_SECRET_ENCRYPTION_KEY`

`[REQUIRED]` `[SENSITIVE]` At-rest encryption key for stored integration
credentials and device secrets. At least 32 characters (the installer
generates 64). A non-dev boot fails when neither this nor `JWT_SECRET` is set,
so a deploy is never silently insecure. Keep it distinct from `JWT_SECRET`:
the installer regenerates it if the two match.

### `FM_SECRET_ENCRYPTION_KEY_ID` / `FM_SECRET_ENCRYPTION_KEY_PREVIOUS` / `FM_SECRET_ENCRYPTION_KEY_PREVIOUS_ID`

`[OPTIONAL]` `[SENSITIVE]` Key-rotation set. `FM_SECRET_ENCRYPTION_KEY_ID`
labels the active key (default `primary`). `FM_SECRET_ENCRYPTION_KEY_PREVIOUS`
(+ its `_ID`) is a decrypt-only prior key so data written before a rotation
still reads. Set the previous pair during rotation, then clear it once every
row has been rewrapped.

### `JWT_SECRET`

`[REQUIRED]` `[SENSITIVE]` Signs session and API tokens. It also doubles as the
legacy at-rest encryption fallback, so it must be at least 32 characters (the
installer generates 64). Keep it distinct from `FM_SECRET_ENCRYPTION_KEY`.

### `FM_SECRET_KDF_SALT`

`[REQUIRED]` `[SENSITIVE]` Salt for the scrypt KDF used by `secretCrypto`
v2. Minimum 16 chars. Each deployment must generate its own (the salt
binds derived keys to this deployment). `deploy-public.sh` creates it once on
the first run and saves it in `deploy/state/.env`. Never change or lose it
after data exists: stored secrets can no longer be read, and the installer
refuses to start Fleet Manager when the saved and running values differ. See
[Secret salt](./deploy-public-reference.md#secret-salt-fm_secret_kdf_salt).
If you run Fleet Manager without the installer, generate one with
`openssl rand -base64 24 | tr -d '/+=' | head -c 32`. Old v1 ciphertexts
(SHA-256-derived) keep decrypting; new writes are v2. Run
`backend/scripts/migrate-secret-crypto-rewrap.ts` to rewrap legacy rows.

### `ZITADEL_PG_SHARED_BUFFERS` / `ZITADEL_PG_EFFECTIVE_CACHE` / `ZITADEL_PG_WORK_MEM`

`[OPTIONAL]` Zitadel's own postgres tuning. Prod `128MB` / `256MB` / `2MB`.

### `ZITADEL_MEM_LIMIT`

`[OPTIONAL]` Docker memory limit on the Zitadel container. Default
`256MiB`.

### `ZITADEL_FORCE_MFA`

`[OPTIONAL]` Require a second factor (TOTP, OTP-Email, OTP-SMS, U2F,
passkey, etc.) on every login. Default `false`. Drives two paths:

- **First-init**: passed straight through to
  `ZITADEL_DEFAULTINSTANCE_LOGINPOLICY_FORCEMFA` so brand-new instances
  come up with the desired policy baked into the default Login Policy.
- **Existing instances**: `bootstrap-zitadel.sh` runs every deploy and
  PUTs the default Login Policy via `/admin/v1/policies/login` with the
  `forceMfa` flag set from this var. The update is idempotent, Zitadel
  responds `No changes` when the flag already matches.

Users without a registered second factor are prompted to enroll one on
their next login (TOTP via authenticator app is the default; passkeys are
allowed when `ZITADEL_PASSWORDLESS_TYPE=1`). Set to `true` for prod /
SaaS tenants handling sensitive access; leave `false` for dev / local
where MFA enrollment friction is unwanted.

To override per-organization (rather than instance-wide), set the org's
own Login Policy in the Zitadel Console, instance-wide updates do not
overwrite an explicit org-scoped policy.

### `ZITADEL_DEBUG_OIDC_PARENT_ERROR`

`[OPTIONAL]` Surface upstream OIDC errors in Zitadel logs. Default `true`
in non-prod env files, `false` in `prod.env` / `public.env` (errors are
noisy and may leak issuer detail). Maps to
`ZITADEL_DEFAULTINSTANCE_FEATURES_DEBUGOIDCPARENTERROR`.

### `ZITADEL_BACKUP_INTERVAL` / `FM_BACKUP_RETAIN_DAYS`

`[OPTIONAL]` Cadence (seconds) between `zitadel-backup` `pg_dump` runs and
retention (days). Defaults `86400` / `7`; `prod.env` and `staging.env` keep
`14` days. Backups land in `deploy/state/backups/zitadel/zitadel-<ts>.sql.gz`.

### `FM_ZITADEL_GDPR_SIGNING_KEY` / `FM_ZITADEL_GDPR_SIGNING_KEY_PREVIOUS`

`[REQUIRED]` `[SENSITIVE]` HMAC key for the `user.removed` GDPR cascade
target. Bootstrapped by `bootstrap-zitadel-actions.sh` and propagated via
`state/fm-runtime.env`. The `_PREVIOUS` slot is populated when running with
`--rotate`; both keys verify until the operator clears the previous slot
after the replay window.

### `FM_ZITADEL_GRANT_SIGNING_KEY` / `FM_ZITADEL_GRANT_SIGNING_KEY_PREVIOUS`

`[REQUIRED]` `[SENSITIVE]` HMAC key for the `user.grant.removed` /
`user.grant.cascade.removed` target, clears FM userinfo cache + V2 shape
on revoke. Same lifecycle as the GDPR key.

### `FM_ZITADEL_ACTION_REPLAY_SKEW_MS`

`[OPTIONAL]` Replay window for Action V2 + GDPR webhook timestamps.
Default `300000` (5 min). Deliveries with `t=` outside the window are
rejected as `timestamp outside replay window`.

### `FM_ZITADEL_SCIM_ENABLED`

`[OPTIONAL]` Inbound SCIM v2 provisioning toggle. Default `false`.
The Zitadel SCIM endpoint lives at `/scim/v2/`; enable when an
enterprise identity broker (Okta, Entra, etc.) needs to push users +
groups into the FM Zitadel instance. Authenticated via PAT. When enabled,
bootstrap provisions the SCIM service user as a Zitadel instance-level
administrator with `IAM_OWNER` using the InternalPermissionService
instance resource.

### `FM_OIDC_SCOPE`

`[REQUIRED]` Space-separated OIDC scope list. **Must include**
`urn:zitadel:iam:user:resourceowner` so the backend can scope RPCs
per organization.

---

## Admin bootstrap

### `FM_ADMIN_USER` / `FM_ADMIN_PASSWORD` / `FM_ADMIN_EMAIL`

Bootstrap admin identity. Password `[REQUIRED]` `[SENSITIVE]`. `deploy-public.sh` creates a random password when it is empty and saves it in `deploy/state/initial-credentials.txt`.

### `FM_PLATFORM_ADMIN_USER` / `FM_PLATFORM_ADMIN_EMAIL`

Provider support identity in `FM_PLATFORM_ORG_NAME`.

### `FM_PLATFORM_ADMIN_PASSWORD`

Required `[SENSITIVE]`. Bootstrap uses it for the platform admin user and
deploy summaries print it with the other login credentials.

### `FM_PLATFORM_ADMIN_ROLE`

Bootstrap variable for the platform admin account. Default `IAM_OWNER`, granted
at Zitadel instance level. FM trusts it only when the authenticated user belongs
to the configured Shelly/platform org.

### `FM_PLATFORM_SUPPORT_READ_ROLE`

Bootstrap variable for the FM backend service account. Default
`IAM_OWNER_VIEWER`, granted at Zitadel instance level so the backend can verify
provider-support authority.

---

## Fleet Manager process

### `FM_VERSION`

`[OPTIONAL]` Container image tag. `latest` in public deploy, pinned
semver in prod.

### `FLEET_MANAGER_PORT`

`[OPTIONAL]` Host port for the FM UI. Default `7011`. The app inside
the container always listens on `7011`; this only maps the host side.

### `FM_HEAP_SIZE`

`[OPTIONAL]` Node.js heap (MB). Prod `2048`, public `1024`.

### `FM_PLAIN_WS`

`[OPTIONAL]` Allow `ws://` on port 80 at `/shelly` for Wall Display
devices. Default `false`.

### `FM_EDGE_SUBNET`

`[REQUIRED]` IPv4 subnet (`/24` to `/29`) of the `fleet-edge` network that
only Traefik and Fleet Manager join. Compose gives the network this subnet
and derives `FM_DEVICE_INGRESS_TRUSTED_PROXY_CIDRS` (`127.0.0.1/32,<subnet>`)
from it. Shipped value `172.30.255.0/29`. The deploy refuses a malformed
value or one that overlaps another Docker network or a host route.

### `FM_DEVICE_INGRESS_PROXY_REQUIRED`

`[OPTIONAL]` `true` where a proxy fronts `/shelly`: Fleet Manager refuses
to start when the trusted proxy list is empty or malformed. `false` in dev
and local, where it only warns. Default `false`.

### `FM_DEVICE_MTLS`

`[OPTIONAL]` `true` makes `/shelly` require an FM-issued client certificate
at Traefik and lets Fleet Manager read the forwarded certificate headers,
from the trusted proxy only. Address and scheme trust does not depend on it.
Default `false`.

### `FM_DEBUG_DEFAULT` / `FM_PERF_TRACING` / `FM_OBSERVABILITY`

`[OPTIONAL]` Frontend debug / perf / observability at startup.
Default `false` in prod.

### `FM_API_CONTRACT_VERSION`

`[REQUIRED]` Backend runtime contract version returned by `System.Bootstrap`.

### `FM_UI_CONTRACT_VERSION`

`[REQUIRED]` Frontend/runtime compatibility contract version.

### `FM_FRONTEND_ARTIFACT_ID`

`[REQUIRED]` Frontend artifact/template identifier exposed by `System.Bootstrap`.

### `FM_FRONTEND_ARTIFACT_VERSION`

`[REQUIRED]` Frontend artifact version exposed by `System.Bootstrap`.

### `FM_DEPLOYMENT_MODE`

`[REQUIRED]` Runtime mode. Allowed values:
`oss | shared_saas | dedicated_saas`.

Gates SaaS-only code paths via `isSaasMode()` / `requireSaasMode(feature)` in
[`backend/src/modules/saasMode.ts`](../../../backend/src/modules/saasMode.ts).
Self-hosted installs use `oss` (set in `deploy/env/public.env`).

### `FM_SAFE_MODE`

`[REQUIRED]` Force fallback runtime mode on or off.

---

## SSL / TLS

### `SSL_EMAIL`

`[OPTIONAL]` Email for Let's Encrypt expiry notifications. Used only
with `./deploy/deploy-public.sh up --ssl`.

---

## Per-organization defaults

### `FM_DEFAULT_DASHBOARD_NAME` / `FM_DEFAULT_DASHBOARD_TYPE`

Dashboard created on first login per org. Defaults
`Default Dashboard` / `classic`.

---

## Notifications

### `FM_ENDPOINT_AUTOOFF_THRESHOLD`

Consecutive delivery failures before an endpoint is auto-disabled.
Default `10`.

---

## Fleet Manager performance tuning

All commented by default. See [tuning.md](tuning.md) for sizing.

`FM_STREAMS_KILL_SWITCH` (default `false`): set `true` to turn off every Redis
hot path at boot (same effect as `FM_REDIS_DISABLED`), for emergencies only.

| Var | Default | Purpose |
|---|---|---|
| `FM_MAX_CONCURRENT_INITS` | 100 | Parallel device inits on reconnect |
| `FM_MAX_CONCURRENT_EM_SYNCS` | 40 | Parallel energy-meter syncs |
| `FM_RPC_TIMEOUT_MS` | 60000 | Device RPC timeout (ms) |
| `FM_MAX_PENDING_RPCS` | 10 | Queued RPCs per device |
| `FM_STATUS_QUEUE_MAX` | 50000 | Max buffered status messages |
| `FM_STATUS_FLUSH_INTERVAL_MS` | 250 | Status batch flush (ms) |
| `FM_AUDIT_FLUSH_INTERVAL_MS` | 2000 | Audit batch flush (ms) |
| `FM_AUDIT_QUEUE_MAX` | 100 | Max buffered audit entries |
| `FM_DEVICE_CACHE_TTL_MS` | 5000 | Filtered-device cache TTL (ms) |
| `FM_DEVICE_RELATIONSHIP_QUERY_DEFAULT_LIMIT` | 25 | device.Relationships.Query default page size |
| `FM_DEVICE_RELATIONSHIP_QUERY_MAX_LIMIT` | 50 | device.Relationships.Query max page size |
| `FM_DEVICE_RELATIONSHIP_DEPTH_TWO_MAX_EXPANSIONS` | 25 | device.Relationships.Get depth=2 related-device expansion cap |
| `FM_DEVICE_RELATIONSHIP_DEVICE_SIDE_FAMILY_LIMIT` | 50 | device.Relationships.Get device-side facts per family |
| `FM_GRAFANA_PROXY_TIMEOUT_MS` | 30000 | Upstream Grafana fetch timeout |
| `FM_GRAFANA_PROXY_MAX_BYTES` | 52428800 | Max proxied response (50 MB) |
| `FM_SEEN_LOGIN_TOKEN_TTL_MS` | 7200000 | Login-audit dedup TTL |
| `FM_OUTBOX_CONCURRENCY` | 5 | Notification outbox parallel sends |
| `FM_OUTBOX_MAX_ATTEMPTS` | 6 | Notification retries before DLQ |
| `FM_OUTBOX_UNFLUSHED_STALE_MS` | 600000 | Re-flush the group of a never-claimed alert job after this age |
| `FM_OUTBOX_UNFLUSHED_MAX_AGE_MS` | 86400000 | Never re-flush an alert job older than this |
| `FM_DELIVERY_HTTP_TIMEOUT_MS` | 10000 | Webhook adapter timeout |
| `FM_DELIVERY_ERROR_SNIPPET_MAX` | 500 | Bytes of error kept in audit |
| `FM_ALERT_BATTERY_DEFAULT_PCT` | 20 | Fallback battery_below threshold |
| `FM_RATE_LIMIT_GENERAL_RPM` | 240 | Per-user RPC rate limit |
| `FM_RATE_LIMIT_EXPENSIVE_RPM` | 30 | Admin/write rate limit |
| `FM_RATE_LIMIT_BILLING_RPM` | 120 | Per-user, per-method `Bill.Quote` rate limit |
| `FM_RATE_LIMIT_ORG_BILLING_RPM` | 1200 | Per-organization, per-method `Bill.Quote` rate limit |
| `FM_RATE_LIMIT_EXPENSIVE_METHODS` | *(code defaults)* | CSV override |
| `FM_DEVICE_PROBE_TIMEOUT_MS` | 5000 | `/api/device-proxy` timeout |
| `FM_NODE_RED_ENABLED` | false | Enable the standalone Node-RED proxy |
| `FM_NODE_RED_PROXY_TARGET` | `http://nodered:1880` | Private Node-RED upstream |
| `FM_NODE_RED_PROXY_SECRET` | *(empty)* | Shared FM-to-Node-RED proxy secret |
| `FM_NODE_RED_UI_PERMISSIONS` | `automation:update,automation:*` | Coarse permissions (from an identity-provider role) that open the editor. A persona assigned inside Fleet Manager opens it through the policy evaluator, not this list |
| `FM_NODE_RED_SESSION_ALLOWED_ORIGINS` | *(empty)* | Browser origins allowed to bootstrap a cross-origin Node-RED editor session |
| `FM_NODE_RED_SESSION_COOKIE_SAMESITE` | `strict` | Node-RED editor cookie SameSite mode: `strict`, `lax`, or `none` |
| `FM_NODE_RED_USER_DIR` | `./cfg/node-red` | Node-RED user directory |
| `FM_NODE_RED_SERVICE_TOKEN` / `_SERVICE_USER_ID` | *(bootstrap)* | Node-RED runtime service identity |
| `FM_NODE_RED_ORG_ID` | *(bootstrap)* | Org pin for the runtime service token |
| `FM_NODE_RED_PERMISSIONS` | *(unset: `device:read,device:execute,action:execute,action:read,action:update,group:read,location:read,tag:read,dashboard:read,notification:update`)* | Replaces what Node-RED flows may do. Default: Node-RED may read devices, groups, places, tags, dashboards and variables, control devices, save variables and send through notification channels. It may not change device settings or create, change or delete groups, places or tags: flows run unattended, so writes stay limited to what the shipped nodes need. |
| `FM_GRAFANA_DS_MAX_OPEN_CONNS` / `_IDLE_CONNS` / `_CONN_LIFETIME_SEC` | 10 / 10 / 14400 | Grafana DS pool |
| `FM_DASHBOARD_DEFAULT_TARIFF` | 0 | Default tariff for new dashboards |
| `FM_DASHBOARD_DEFAULT_CURRENCY` | EUR | Currency code |
| `FM_DASHBOARD_DEFAULT_RANGE` | last_7_days | Default time range |
| `FM_DASHBOARD_REFRESH_MS` | 60000 | Auto-refresh interval (ms) |

---

## Group-type policy defaults

Operators override per group in the UI. Empty → use code defaults.

- `FM_GROUP_POLICY_SEVERITY_FLOOR_{STANDARD,OPERATIONAL,CRITICAL,CUSTOM}`
 , `info | warning | critical`. Empty = no floor.
- `FM_GROUP_POLICY_RETENTION_{STANDARD,OPERATIONAL,CRITICAL,CUSTOM}_DAYS`
 , per-group-type status retention. Empty → `STATUS_RETENTION`.
- `FM_GROUP_POLICY_RETENTION_FALLBACK_DAYS`: default `7`.
- `FM_GROUP_POLICY_SWEEP_INTERVAL_MINUTES`: default `60`.
- `FM_GROUP_POLICY_AUDIT_RETENTION_{STANDARD,OPERATIONAL,CRITICAL,CUSTOM}_DAYS`
 , audit retention per group type.
- `FM_GROUP_POLICY_AUDIT_RETENTION_FALLBACK_DAYS`: default `90`.

---

## Frontend log / audit UI

Injected into `runtime-config.js`, change + redeploy takes effect with
no frontend rebuild.

- `FM_LOG_BUFFER_MAX` (default `2000`), max log entries in the
  in-memory console buffer.
- `FM_LOG_CATEGORY_MAX` (default `100`), max log4js categories in
  filter dropdowns.
- `FM_AUDIT_PAGE_SIZE` (default `100`), page size for
  `/monitoring/audit-log` search.
- `FM_ZITADEL_PASSWORD_MIN_LENGTH` (default `8`), minimum password
  length displayed and validated in the user creation modal.
- `FM_CLIENT_ORG_ID`: generated into `fm-runtime.env` from
  `FM_CLIENT_ORG_NAME`. Pins this FM process to one Zitadel org. JWTs from
  other orgs are rejected at auth, except hidden provider support authority.

---

## Frontend UI tunables (`FM_UI_*`)

Flow: `deploy/env/*.env` → `entrypoint.sh` →
`window.__FM_RUNTIME_CONFIG__.ui` → `frontend/src/config/ui.ts`.
Hard-refresh the browser after redeploy to drop cached
`runtime-config.js`.

### `FM_UI_NOW_TICKER_MS`, default `30000`

"X ago" / "last seen" relative-timestamp refresh rate (ms).

### `FM_UI_LIST_SKELETON_COUNT`, default `4`

Skeleton placeholder cards shown on list pages during the first fetch.

### `FM_UI_ALERT_TIMER_<SEVERITY>_<LEVEL>_MINS`

Alert age (minutes) at which the urgency badge flips colour.

| Var | Default | Badge flips at |
|---|---|---|
| `FM_UI_ALERT_TIMER_CRITICAL_AMBER_MINS` | 5 | Critical → amber |
| `FM_UI_ALERT_TIMER_CRITICAL_DANGER_MINS` | 15 | Critical → red |
| `FM_UI_ALERT_TIMER_WARNING_AMBER_MINS` | 30 | Warning → amber |
| `FM_UI_ALERT_TIMER_WARNING_DANGER_MINS` | 120 | Warning → red |
| `FM_UI_ALERT_TIMER_INFO_AMBER_MINS` | 120 | Info → amber |
| `FM_UI_ALERT_TIMER_INFO_DANGER_MINS` | 480 | Info → red |

### `FM_UI_SILENCE_PRESET_MINUTES`, default `15,60,240,480,1440`

CSV of minute durations used as "silence alert" quick-pick buttons.

### `FM_UI_SILENCE_TOMORROW_HOUR`, default `9`

Hour of next calendar day (0–23, local) for "silence until tomorrow".

### `FM_UI_TOAST_DEFAULT_MS`, default `5000`

Auto-dismiss (ms) for toasts with no action button.

### `FM_UI_TOAST_ACTION_MS`, default `8000`

Auto-dismiss (ms) for toasts with an action button (Undo / View /
Retry), longer so users can click.

### `FM_UI_TOAST_MAX_STACK`, default `5`

Max toasts visible at once; oldest is evicted above this.

### `FM_UI_URL_SYNC_DEBOUNCE_MS`, default `300`

Debounce (ms) before persisting `?search=` / `?sort=` to the URL on the
Devices list so rapid typing doesn't spam history entries.

### `FM_UI_DUPLICATE_CHECK_DEBOUNCE_MS`, default `400`

Debounce (ms) before `Alert.Rule.CheckDuplicate` fires on rule-form field
changes. Shorter = earlier warning, more RPCs; longer = fewer RPCs, later
warning.

### `FM_UI_TEMPLATE_PREVIEW_DEBOUNCE_MS`, default `300`

Debounce (ms) before `Notification.RenderTemplate` is called as the user
types in summary/message templates.

### `FM_UI_OPTIMISTIC_FLASH_MS`, default `220`

How long the "✓ Saved" / "✓ Created" flash is shown on edit modals
before they dismiss. Consumed by `useOptimisticSave` composable.
Lower = snappier close; higher = more obvious success feedback.

### `FM_UI_OPTIMISTIC_RECONCILE_TIMEOUT_MS`, default `3000`

After an optimistic device-status patch (relay/light/cover toggle, etc.)
is applied, if no real `Shelly.Status` echo arrives within this window
the UI fires a one-shot `Shelly.GetStatus` to force a refresh. Lower =
faster reconciliation on dropped echoes; higher = fewer fallback RPCs
on a busy fleet. Required in env files; compose keeps a safe default for
older deployments.

### `FM_UI_OPTIMISTIC_REAPER_MS`, default `60000`

How often the frontend clears expired optimistic device-state overlays.
This is display-only cleanup; backend-reported state remains the source
of truth. Required in env files; compose keeps a safe default for older
deployments.

### `FM_UI_SEARCH_THRESHOLD`, default `0.4`

Fuse.js match threshold for in-app fuzzy search. Float in `[0.0, 1.0]`.
`0.0` = exact match only, `1.0` = match anything. Default `0.4` is
forgiving without being noisy. Capped to 4 decimal places.

### `FM_UI_SEARCH_IGNORE_LOCATION`, default `true`

Fuse.js `ignoreLocation`, `true` means character position within the
string doesn't affect score (matches anywhere are ranked equally).
Flip to `false` only if you want early-string matches to rank higher.

### `FM_UI_FIRINGS_PAGE_SIZE`, default `100`

Rows fetched per `Alert.Rule.ListFirings` page on the rule detail Firings
tab. Cap: 1000 (backend `LIMIT_SCHEMA`).

### `FM_UI_GROUP_ACTIVITY_PAGE_SIZE`, default `200`

Rows fetched per `Group.ListActivity` page on the group detail Activity
tab. Cap: 1000 (backend `LIMIT_SCHEMA`).

### `FM_UI_SHORTCUT_*`, keyboard shortcut bindings

DSL per value:

- `mod+key`: Ctrl/Cmd + key (e.g. `mod+z`).
- `mod+shift+key`: Ctrl/Cmd + Shift + key.
- `mod+alt+key`: Ctrl/Cmd + Alt + key.
- literal symbol, `?`, `!`, etc.
- `escape`: Esc key.
- **empty value disables the shortcut** (the matching modal row is hidden).

`mod` resolves to `⌘` on macOS and `Ctrl` elsewhere. Shift is
implicit for symbol keys (e.g. `?` doesn't need `shift+`).

| Var | Default | Action |
|---|---|---|
| `FM_UI_SHORTCUT_HELP` | `?` | Show keyboard-shortcuts overlay |
| `FM_UI_SHORTCUT_CLOSE_INSPECTOR` | `escape` | Close right-side inspector |
| `FM_UI_SHORTCUT_SEARCH_FOCUS` | `mod+k` | Focus universal search |
| `FM_UI_SHORTCUT_DASHBOARD_UNDO` | `mod+z` | Undo (dashboard edit mode) |
| `FM_UI_SHORTCUT_DASHBOARD_REDO` | `mod+shift+z` | Redo (dashboard edit mode) |
| `FM_UI_SHORTCUT_LOGS_FOCUS` | `mod+k` | Focus log search (on `/monitoring/logs`) |
| `FM_UI_SHORTCUT_LOGS_CLEAR` | `mod+l` | Clear log buffer |
| `FM_UI_SHORTCUT_LOGS_CLEAR_SEARCH` | `escape` | Clear log search and blur |

To add a new shortcut: register it in
`frontend/src/config/shortcuts.ts` fallbacks + env chain + one
`registerShortcut({id, …})` call in the relevant component. The call
site never contains the key combo.

---

## Alert notification tunables

### `FM_TEMPLATE_MAX_OUTPUT_CHARS`, default `4000`

Max character length of rendered notification template output. Caps
pathological templates from blowing up delivery payloads.

### `FM_ALERT_PREVIEW_MAX_DEVICES`, default `5000`

Cap on devices scanned by `Alert.Rule.Preview` per call.

### `FM_ALERT_PREVIEW_MAX_MATCHES`, default `200`

Cap on matches returned by `Alert.Rule.Preview` per call.

### `FM_ALERT_BATTERY_DEFAULT_PCT`, default `20`

Fallback threshold percent for `battery_below` rules when
`config.thresholdPct` is unset.

### `FM_ENDPOINT_AUTOOFF_THRESHOLD`, default `5`

Consecutive delivery failures before a channel
auto-disables. Reset via `Channel.ResetHealth`.

### `FM_DELIVERY_HTTP_TIMEOUT_MS`, default `10000`

Per-request timeout for HTTP webhook adapters.

### `FM_DELIVERY_ERROR_SNIPPET_MAX`, default `500`

Bytes of error body kept in `delivery_attempts.error_message`.

### `FM_OUTBOX_CONCURRENCY`, default `5`

Parallel send workers in the notification outbox.

### `FM_OUTBOX_MAX_ATTEMPTS`, default `6`

Retry ceiling before a delivery job terminates as `failed`.

### `FM_NOTIFICATION_RECEIPT_SIGNING_SECRET`

`[OPTIONAL]` HMAC secret for `POST /api/notifications/provider-receipts/:provider`.
Set this when provider delivery webhooks are enabled. The sender must sign
the raw JSON body with `sha256=<hex>` in `x-fm-signature`. Empty means
receipt callbacks are rejected.

---

## Alert grouping (Alertmanager-style batching)

Stops a single mass event (e.g. 7000 devices going offline at once) from
producing 7000 notifications. Alerts sharing a group key accumulate for
`GROUP_WAIT_SEC`, then fire as **one** notification per endpoint. Model
copied verbatim from Prometheus Alertmanager / Grafana / PagerDuty.

### `FM_ALERT_GROUP_WAIT_SEC`, default `60`

After the first alert of a new group arrives, wait this long for
siblings before sending the first batch. Alertmanager ships 30s,
PagerDuty 300s, 60s lands in the middle with good coalescing at
device-fleet scale. Must be ≤ `GROUP_INTERVAL_SEC`.

### `FM_ALERT_IMMEDIATE_SEVERITIES`, default `critical`

Comma-separated severities whose first notification skips
`GROUP_WAIT_SEC` and goes out at once. Later notifications for the same
group still keep `GROUP_INTERVAL_SEC` apart, so a flapping critical alert
cannot spam a channel. Set it empty to batch every severity.

### `FM_ALERT_GROUP_INTERVAL_SEC`, default `300`

Minimum delay between subsequent batches for the **same** group while
still firing. Industry default across Alertmanager / Grafana / PagerDuty.

### `FM_ALERT_REPEAT_INTERVAL_SEC`, default `14400`

Renotify interval for unresolved groups. Must be a whole multiple of
`GROUP_INTERVAL_SEC` (loud error at boot if not). Alertmanager/Grafana
default.

### `FM_ALERT_GROUP_BY`, default `organization_id,rule_id,severity`

CSV of label names forming the group key. Alerts whose label values
match land in the same group. Per-rule override via the rule's
`groupBy` field.

### `FM_ALERT_GROUP_MAX_MEMBERS`, default `1000`

Early-flush cap. When a group reaches this many alerts, flush
immediately instead of waiting. PagerDuty's proven at-scale per-incident
limit, beyond this, renderings become incoherent anyway.

### `FM_ALERT_STORM_SUMMARY_THRESHOLD`, default `25`

When a group has more than this many alerts, adapters render a summary
card ("42 alerts: 5 critical, 37 warning. Open in Fleet.") instead of
listing each alert. Keeps cards under provider size limits.

---

## Email template branding

### `FM_EMAIL_BRAND_NAME`, default `Fleet Manager`

Text shown in the branded email header when no logo is set.

### `FM_EMAIL_BRAND_LOGO_URL`

`[OPTIONAL]` Absolute HTTPS URL to a small (28px) logo used in the email
header. Empty = use brand name text.

### `FM_EMAIL_COLOR_INFO`, default `#3b82f6`

### `FM_EMAIL_COLOR_WARNING`, default `#f59e0b`

### `FM_EMAIL_COLOR_CRITICAL`, default `#ef4444`

Accent colors (header band + CTA) per severity.

### `FM_ALERT_LINK_BASE`

`[OPTIONAL]` Base URL for the "Open alert" CTA / inline button. Shared
across all delivery adapters (email, Telegram, Slack, Teams). e.g.
`https://fleet.example.com/alerts`. Empty = button/link omitted.

---

## Notification display (severity + state labels)

Single source of truth for the icons + words every delivery adapter
uses. Change once, applies to email / Telegram / Teams / Slack.

### `FM_NOTIFICATION_SEVERITY_EMOJI_CRITICAL`, default `🔴`

### `FM_NOTIFICATION_SEVERITY_EMOJI_WARNING`, default `🟡`

### `FM_NOTIFICATION_SEVERITY_EMOJI_INFO`, default `🔵`

Severity indicators used by Telegram, Teams, and the Email HTML badge.

### `FM_NOTIFICATION_SEVERITY_COLOR_CRITICAL`, default `#dc2626`

### `FM_NOTIFICATION_SEVERITY_COLOR_WARNING`, default `#d97706`

### `FM_NOTIFICATION_SEVERITY_COLOR_INFO`, default `#2563eb`

Hex colors exposed to message templates as `{{display.severityColor}}`.

### `FM_NOTIFICATION_STATE_LABEL_ACTIVE`, default `active`

### `FM_NOTIFICATION_STATE_EMOJI_ACKNOWLEDGED`, default `✅`

### `FM_NOTIFICATION_STATE_EMOJI_RESOLVED`, default `✔️`

State badges shown when an alert moves beyond `active`.

### `FM_NOTIFICATION_STATE_LABEL_ACKNOWLEDGED`, default `acknowledged`

### `FM_NOTIFICATION_STATE_LABEL_RESOLVED`, default `resolved`

Lowercase words paired with the state emoji. Localize here for non-English.

### `FM_NOTIFICATION_SLACK_SEVERITY_EMOJI_CRITICAL`, default `:rotating_light:`

### `FM_NOTIFICATION_SLACK_SEVERITY_EMOJI_WARNING`, default `:warning:`

### `FM_NOTIFICATION_SLACK_SEVERITY_EMOJI_INFO`, default `:information_source:`

Slack-flavor shortcodes. Set to Unicode (`🔴🟡🔵`) to match other
adapters, or keep shortcode defaults for Slack's iconic rendering.

---

## Telegram bot delivery

### `FM_TELEGRAM_API_BASE`, default `https://api.telegram.org`

Override when routing through a local relay (air-gapped environments).

### `FM_TELEGRAM_MESSAGE_MAX_CHARS`, default `4096`

Telegram's hard cap. Rendered messages longer than this are truncated
with a trailing "…".

### `FM_TELEGRAM_DEFAULT_TEMPLATE`

`[OPTIONAL]` Instance-wide default message template. Per-endpoint
`messageTemplate` takes precedence; empty = built-in structured default
(severity emoji + label + title + message).

---

## Microsoft Teams workflow webhook

### `FM_TEAMS_CARD_VERSION`, default `1.5`

Adaptive Card schema version sent to Teams. `1.5` (shipped Oct 2022) is
the current Teams/Power Automate default and supports every widget this
adapter emits. Pin to `1.4` only if you're targeting legacy embedded
Teams clients (e.g. first-gen Surface Hub) that haven't received the
1.5 runtime.

### `FM_TEAMS_MAX_CARD_BYTES`, default `25000`

Pre-send byte cap for the rendered Adaptive Card envelope. Teams
silently drops cards above ~28KB, we stay below that margin so
templates that produce oversized output surface as a recorded
`delivery_attempts` failure instead of a confusing silent delivery.
Minimum accepted value is 1000.

### `FM_TEAMS_DEFAULT_TEMPLATE`

`[OPTIONAL]` Instance-wide card JSON template. Per-endpoint
`cardTemplate` takes precedence; empty = built-in chrome (severity
header, FactSet, OpenUrl action).

### `FM_TEAMS_WEBHOOK_ALLOWED_HOSTS`

`[OPTIONAL]` CSV of host suffixes that webhook URLs must match (SSRF
hardening). Each entry is matched as suffix, prepending `.` if absent:
e.g. `.logic.azure.com` matches `prod-1.westus.logic.azure.com` but
not `example.com`. Empty (default) disables the check.

This is the only place Teams webhook hosts are restricted; the form
checks the URL is well-formed https and nothing more. Microsoft issues
workflow URLs from two places depending on when the flow was created,
so an allowlist needs both: `.logic.azure.com` (Logic Apps) and
`.environment.api.powerplatform.com` (Power Automate). Setting only the
first will reject flows created in the Teams Workflows app today.

### `FM_TEAMS_MENTION_SEVERITIES`, default `critical`

CSV of severity levels on which Teams `mentions` fire (`info`,
`warning`, `critical`). Empty disables mentions entirely regardless of
per-endpoint config.

---

## BLU discovery (scan for BLU devices)

| Variable | Default | Meaning |
|---|---|---|
| `FM_BTHOME_DISCOVERY_DURATION_SEC` | `30` | How long a gateway listens per scan. The browser follows this value. |
| `FM_BTHOME_DISCOVERY_TTL_SEC` | `900` | A BLU device not heard for this long drops out of the scan list. The list shows "Heard 3m ago" per device. |
| `FM_BLU_PROVENANCE_RETENTION_DAYS` | `30` | Days Fleet keeps the record of which gateway relayed each BLU sample. Older records are removed every 10 minutes. The readings themselves are not affected. |

## Location taxonomy

CSV lists that drive the combobox option sets returned by
`Location.ListKinds`. Empty = use built-in defaults. End users may still
submit custom values (subject to the shared enum-value safety regex).

### `FM_LOCATION_SITE_TYPES`

Default: `office,warehouse,retail,data-center,manufacturing,hospitality,healthcare,education,residential,mixed-use`.

### `FM_LOCATION_BUILDING_TYPES`

Default: `office,warehouse,retail,data-center,manufacturing,hospitality,healthcare,education,residential,industrial`.

### `FM_LOCATION_ROOM_TYPES`

Default: `office,meeting,server,mechanical,storage,kitchen,bathroom,lobby,cleanroom,lab`.

### `FM_LOCATION_OPERATIONAL_TIERS`

Default: `critical,production,staging,development`.

### `FM_LOCATION_COMPLIANCE_TAGS`

Default: `HIPAA,PCI-DSS,SOC2,ISO-27001,GDPR-strict,FDA-regulated,cleanroom`.

### `FM_LOCATION_ACCESS_PROCEDURES`

Default: `public,badge,biometric,escort-required,security-cleared`.

### `FM_LOCATION_REGULATORY_ZONES`

Default: `EU,US,UK,APAC,LATAM,MENA,OTHER`.

### `FM_LOCATION_ENERGY_CERTIFICATIONS`

Default: `LEED-Platinum,LEED-Gold,LEED-Silver,LEED-Certified,BREEAM-Outstanding,BREEAM-Excellent,DGNB-Platinum,DGNB-Gold,none`.

### `FM_LOCATION_CONTACT_ROLES`

Default: `Facility Manager,IT Operations,Security,Maintenance,Reception,Owner,Tenant,Emergency`.

---

## Network / transport

### `FM_LOCAL_WS_PORT`, default `FLEET_MANAGER_PORT + 1`

Legacy loopback WebSocket port. The standalone Node-RED addon should use
Fleet Manager's normal HTTP/WS APIs through its org-scoped service token
instead of the in-process loopback bridge.

---

## Edge security (Traefik)

Public-deploy only. These values control the Traefik reverse proxy in
`deploy/scripts/public/lib/ssl/routes.sh` and are written into the dynamic
config at deploy time. Change them in `deploy/env/*.env` and re-run
`deploy-public.sh up` to regenerate `routes.yml`.

### `FM_EDGE_BLOCK_BOT_PROBES`, default `true`

Toggles the edge bot-probe block. When `true`, a Traefik router
(`bot-block`, priority 250) matches the regex in
`FM_EDGE_BLOCK_BOT_PROBES_PATTERNS` and routes hits to a sink service with
no backends, so Traefik returns 503 before the request reaches Fleet
Manager. Set `false` to disable the filter, useful for direct testing of
paths that would otherwise be blocked.

### `FM_EDGE_BLOCK_BOT_PROBES_PATTERNS`

Traefik `PathRegexp` pattern (RE2 syntax) for paths that should be sunk.
Default covers common scanner targets:

```text
^/\.(env|git|vscode|aws|ssh)|^/backup\.|^/sftp-config|^/wp-(admin|login)|^/robots\.txt|^/phpmyadmin
```

The default does not match `/rpc/`, `/api/`, `/health`, `/metrics`, or any
authenticated path, so AI agents and SDK clients are unaffected. Edit
the pattern to extend or relax the filter.

### `FM_LOGIN_RATE_LIMIT_AVERAGE` / `_BURST` / `_PERIOD`, defaults `10` / `30` / `1m`

Traefik `rateLimit` middleware applied to the Zitadel login routers
(`zitadel-oauth`, `zitadel-login`, `zitadel-api`). `_AVERAGE` is steady-state
requests per `_PERIOD`, `_BURST` is the bucket size. Source criterion is
client IP at proxy depth 1.

---

## Proxy metrics and access log (Traefik)

Both switches apply to every Traefik stack: shared, Let's Encrypt and
self-signed. They are read when the proxy container is created, so re-run
`up` after a change.

### `FM_PROXY_METRICS`, default `true`

Traefik serves Prometheus metrics at `http://traefik:8083/metrics`, with
entrypoint, router and service labels. Port 8083 has no `ports:` mapping,
so only containers on the Docker networks can scrape it. No router uses it.
Set `false` to stop the metrics; the port then answers 404.

### `FM_PROXY_ACCESS_LOG`, default `false`

Set `true` for a JSON access log on the Traefik container output. Each line
keeps only `StartUTC`, `Duration`, `OriginDuration`, `OriginStatus`,
`DownstreamStatus`, `RouterName`, `ServiceName`, `RequestMethod`,
`RequestPath`, `RequestProtocol`, `RequestCount`, `RetryAttempts` and
`Overhead`. All headers and query strings are dropped, so tokens and cookies
never reach the log. One line per request is noisy, and the container log
keeps only 5 files of 1 MB, so turn it on for a diagnosis, then off.

---

## Optional services

### `MDNS_ON` / `MDNS_TO`

Upstream / downstream interfaces for the mDNS repeater
(`./deploy/deploy-public.sh up --mdns`). Default `enp1s0` / `br-fleet`.

### `GF_ADMIN_PASSWORD`

`[OPTIONAL]` `[SENSITIVE]` Grafana admin password, for builds that include
the Grafana add-on. Change before exposing externally.

### `DOZZLE_PORT`, default `9999`

Web-UI port for the Dozzle container-log viewer
(`./deploy/deploy-public.sh up --logging`).

---

## Build-time overrides

### `NODE_RED_IMAGE` / `NODE_RED_EXTRA_NODES` / `NODE_RED_ALLOWED_NODES`

`[OPTIONAL]` Standalone Node-RED image and startup node install policy.
By default `./deploy/deploy-public.sh up --nodered` uses
`nodered/node-red:${NODE_RED_VERSION}` (pinned in `deploy/VERSIONS.env`)
and mounts `packages/node-red-fleet-manager` into the sidecar so the
Fleet Manager nodes are installed from that folder before Node-RED starts.
They do not come from the npm registry. Point
`NODE_RED_IMAGE` at a prebuilt image with approved nodes already installed if
you do not want startup-time local package installation. `NODE_RED_EXTRA_NODES`
remains available for development/self-hosted runtime installs and is
constrained by `NODE_RED_ALLOWED_NODES`.

### `FM_NODE_RED_URL` / `FM_NODE_RED_SESSION_URL`

`[OPTIONAL]` Frontend runtime Node-RED editor iframe URL and session bootstrap
URL, written by `entrypoint.sh` into `runtime-config.js`. If
`FM_NODE_RED_SESSION_URL` is omitted, Fleet Manager derives it from
`FM_NODE_RED_URL` by replacing the `/red` editor suffix with `/session`. Use an
explicit session URL when serving the editor from a dedicated origin/subdomain.
For cross-origin editor hosting, set
`FM_NODE_RED_SESSION_ALLOWED_ORIGINS=https://fleet.example.com` on the backend
and `FM_NODE_RED_SESSION_COOKIE_SAMESITE=none` when the session cookie must be
accepted by the dedicated editor origin. `SameSite=None` requires HTTPS; Fleet
Manager marks that cookie `Secure`.

Vite-only development builds may use `VITE_NODE_RED_URL` and
`VITE_NODE_RED_SESSION_URL` for the same frontend constants.

---

## How to change a value

1. Edit `deploy/env/public.env`.
2. Run `./deploy/deploy-public.sh up`; the entrypoint re-injects runtime config.
3. Hard-refresh the browser for any `FM_UI_*` or `FM_LOG_*` change so
   the new `runtime-config.js` is loaded.
