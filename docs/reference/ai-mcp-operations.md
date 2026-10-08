<!-- audience: public -->
# AI and MCP Operations

Connect an agent to a running Fleet Manager and it can understand, read, plan,
and operate the system, through permissioned, audited, confirmed tools. Never
raw unrestricted API execution. This doc describes the operations surface: the
tools an agent gets, the governance around them, and how a write actually runs.
For the short entrypoint and the read-only docs tools, read
`docs/reference/ai-and-mcp.md` first.

## The operator flow

1. **Understand.** Use `get_api_method`, `search_docs`, and the
   `HOST_METHOD_METADATA` SDK export to learn what a method is, its params and
   response, its permission, and its safety hints. No state changes here.
2. **Read.** Use `fm_read` for any Fleet Manager read-only method. It runs the
   real RPC as the authenticated user and returns live data.
3. **Plan.** Call `fm_write` with mode `prepare`. It returns a summary, the
   required permission, whether the action is destructive, and a confirmation
   token. It runs nothing.
4. **Act.** Call `fm_write` with mode `execute`. Additive writes (create) run
   immediately. Destructive writes (update, delete), credential issuance and
   writes that start or change an automation come back as
   `confirmation_required` with a token. Call `fm_confirm_write(token)` to run
   the exact reviewed action.
5. **Audit.** Every stateful tool call is logged as an `mcp_tool_call` audit
   event with the user, the method, whether it succeeded, and the error reason
   if it failed. Query it through `audit.Query`.

## Tools

| Tool | Toolset | Read-only | What it does |
|---|---|---|---|
| `list_operation_coverage` | docs | yes | Find reviewed RPC, HTTP, integration and event mappings to MCP workflows or intentional external interfaces. |
| `list_workflows` | docs | yes | Find the ordered API steps for Node-RED authoring, file transfer, assets and durable writes, with explicit runtime and permission limits. |
| `list_methods` | docs | yes | Enumerate the complete API catalog with exact parameter and response schemas, permissions and safety metadata. |
| `list_namespaces` | docs | yes | List every Fleet Manager API namespace with its description, how many methods it holds, how many are read-only, and whether it needs the full capability level. |
| `search_methods` | docs | yes | Find API methods by plain words and get their exact names. |
| `read_resource_chunk` | docs | yes | Read a bounded character range from any listed read-only MCP resource. |
| `search_docs` | docs | yes | Search the Fleet Manager documentation by keyword. |
| `get_api_method` | docs | yes | Look up one API method in the agent catalog: namespaceKind (device\|fleet-manager), descriptions, params/response schemas, permission, safety hints, and the recommended Host SDK wrapper. |
| `get_rpc_method` | docs | yes | Look up a backend RPC method in the generated inventory (declaration provenance and source only; get_api_method returns the richer agent-facing object). |
| `find_frontend_callers` | docs | yes | Find frontend calls for a backend method. |
| `list_devices` | read | yes | List fleet devices (slim, capability-filtered for the caller). |
| `read_energy` | read | yes | Query aggregated energy history. |
| `fm_situation` | read | yes | One call for the current state of the fleet: what is offline, what alerts are still open, and, the useful part, what is CAUSED by the same thing. |
| `list_automations` | read | yes | List the Node-RED automations on this Fleet Manager: their names, whether each is switched on, how big it is, and whether it drives Fleet Manager devices. |
| `find_place` | read | yes | Turn a place name an operator used, "the kitchen", "Store 12", "north wing", into the id the API needs. |
| `fm_capabilities` | read | yes | What this key can and cannot do: its capability level, whether writes and hardware are allowed, which namespaces need the full level, which methods always need a human, which automation writes ask and which automation creates this key already approved, and the current rate and row limits. |
| `fm_read` | read | yes | Run a catalog read-only method permitted by your MCP level, role and resource permissions. |
| `fm_get_operation` | read | yes | Read the persisted state and redacted result of an operation started with idempotencyKey. |
| `fm_reconcile_operation` | read | yes | Inspect authoritative job or upload state for a durable operation. |
| `fm_write` | write | no | Run a Fleet Manager write permitted by the capability policy and the caller's RBAC. |
| `fm_confirm_write` | write | no | Execute a write returned as confirmation_required by fm_write. |

## Governance

The design follows the same patterns other MCP servers use. GitHub's MCP
server groups tools into toolsets and offers a read-only mode. Atlassian's Rovo
MCP gates access with OAuth, RBAC, audit logging, and an allowed-clients list.
Fleet Manager applies the same ideas, enforced server side.

### Toolsets

Tools are grouped like GitHub's MCP toolsets, and each group is gated
differently:

- **docs**: `read_resource_chunk`, `search_docs`, `get_api_method`, `get_rpc_method`,
  `find_frontend_callers`. They change no state. Local stdio needs no auth; the
  live HTTP endpoint always requires auth.
- **read**: `fm_read`, `list_devices`, `read_energy`. Appear only on an
  authenticated request; they run real read-only RPCs as the user.
- **write**: `fm_write`, `fm_confirm_write`. Appear only with auth, and only
  when the key's level allows writes.

A **read** key drops the whole write group; a disabled tenant drops everything;
a **full** key also opens the sensitive namespaces. The control is the key's
level (`read` / `write` / `full`) plus the org `enabled` switch, not a
per-toolset selection.

### Authentication and access

`/mcp` accepts only credentials issued for it: a scoped key whose `audience`
carries `mcp:read`, `mcp:write` or `mcp:full` (bare `mcp` means read), or a
browser-login token from an MCP app (below). The token is read only from the
`Authorization: Bearer` header. Browser
sessions, identity-provider tokens and keys without an MCP audience are refused
with HTTP 401, `WWW-Authenticate: Bearer error="invalid_token"`, JSON-RPC code
-32000 and `reason: "not_authenticated"`, whatever the owner's role, on POST,
GET and DELETE (`mcpIssuedCredentialLevel` in `mcpGovernance.ts`). The level
comes only from the key; RBAC of the key's user still limits what succeeds.
For local dev, mint an `mcp:full` key with `User.CreateScopedPAT`.

Browser login (OAuth, phase 1). Each Fleet registers one public PKCE Zitadel
app per enabled level, `read` and `write` by default (`FM_MCP_OAUTH_LEVELS`;
`full` stays key-only). A user pastes the app's client id, which is public, into
the AI client once, then logs in through the browser as themselves; their RBAC
is the ceiling and writes still ask them. Fleet serves RFC 9728 metadata at
`/.well-known/oauth-protected-resource/mcp`, and `/mcp` answers a missing token
with 401 and `WWW-Authenticate: Bearer resource_metadata=..., scope=...`. A
Zitadel token is an MCP credential only when its `client_id`/`azp` is one of
those apps (`FM_MCP_OAUTH_CLIENT_IDS`, written by the deploy); a token from the
Fleet web app stays a session and is refused at `/mcp`; any other app in the
project is refused everywhere. If Zitadel cannot be reached, `/mcp` answers 503
with `Retry-After` (`FM_MCP_AUTH_RETRY_AFTER_SEC`). Known deviation until Zitadel
supports RFC 8707: the token's `aud` is the Fleet project, so Fleet binds to the
app's client id instead. ChatGPT needs an admin to add its connector callback to
`FM_MCP_OAUTH_EXTRA_REDIRECT_URIS`.

An agent cannot mint keys. Methods that hand out a secret
(`user.CreateScopedPAT`, `user.CreatePAT`, `user.RotatePAT`,
`user.RotateScopedPAT`, `user.BulkRotatePATs`, `auth.MintScopedToken`) are
refused at every level with reason `issues_secret`, and secret fields are always
redacted in MCP results. Other access-granting writes (service users, device
admission, certificates) still always ask a person.

A person's credentials stop when their account stops. Scoped keys, MCP keys
and identity-provider sessions get HTTP 401 with code -32000 at most
`FM_ACCOUNT_STATE_TTL_MS` (default 30 s, range 1 s to 5 min) after the
account is deactivated, locked or deleted in Zitadel, and at once when the
Zitadel event reaches Fleet. If the account state cannot be read, the
credential is refused. A key whose owner has no Fleet role, no Fleet
assignment in the key's tenant and no platform-admin authority is refused on
its next request. An open browser socket is re-checked on its next message
after `FM_WS_USER_REFRESH_INTERVAL_MS`, or closed at once by the event. A
Zitadel-side stop refuses keys while it lasts; deactivating in Fleet also
revokes them. Service accounts are not checked against Zitadel
(`modules/authn/AccountStanding.ts`).

### Connecting an agent, scoping a key for MCP

The industry pattern (GitLab, GitHub, Stripe): a machine identity whose token is
scoped down. Here:

1. **Make a service user and give it an admin role.** MCP runs as this user, so
   its permissions are the ceiling for what the agent can do (RBAC).
2. **Mint a scoped key for it** with `User.CreateScopedPAT`, and put an `mcp`
   scope in its `audience`: `mcp:read`, `mcp:write`, or `mcp:full`. That single
   scope both marks the key for MCP and sets its level, the same way GitLab
   bakes read/write into a scope name (`read_api` vs `api`). Optionally narrow
   `boundaryScope` to limit which data it may touch.
3. **Call `/mcp` with the key** as a bearer header:

```bash
curl -X POST https://<host>/mcp \
  -H "Authorization: Bearer <scoped-key>" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
```

`/mcp` refuses browser sessions, even for an admin. It accepts only a scoped key
with an MCP scope or an OAuth token from an MCP app.

An MCP-scoped key is accepted only at `/mcp`. Normal `/rpc` and `/api` routes
reject it. Invalid MCP scopes also fail closed.

### Capability levels

The level lives on the key (its `mcp` scope), not on the org. Bare `mcp` is
`read`. The level plus RBAC decide what the agent may do:

- **read**: reads only. Write tools are hidden and refused.
- **write**: reads plus any non-sensitive write. Sensitive namespaces
  (credentials, firmware, backup, users, …) stay off.
- **full**: anything the user can do, sensitive namespaces included.

The level only caps how much of the user's power is exposed; RBAC still runs
every call as the user, so MCP can never exceed what that user is allowed to do
in the app. Destructive writes still need the confirm step, and every call is
audited, at every level.

Device methods (namespaceKind `device`) are a `full`-level capability: they
carry real schemas and safety flags, so they preview and confirm like any other
write. Below `full` they are refused `namespace_not_allowed`.

`device.Call` is unwrapped rather than refused (`unwrapDeviceCall` in
`mcpPolicy.ts`): the request is rewritten into the method its `method` field
names, and the ordinary policy judges that. The tunnel therefore reaches
nothing a direct call could not, an unknown inner name, an inner method above
the level, a nested tunnel, and `Script.Eval` inside it are all refused, while
a knowable inner method previews and confirms normally.

What stays structurally refused at every level, `full` included, is anything
`effectDependsOnInput` that cannot be unwrapped: `script.Eval` and
`admin.PostgresCall`. No honest confirmation summary can be built for them, and
an approval prompt that cannot say what it is approving is theatre.

### Per-tenant switch

The level is on the key, so the org profile holds only an on/off switch, in
`metadata.mcpPolicy`, no new table, read via `Organization.GetProfile` and
cached briefly:

- `enabled: false` → `/mcp` returns 403 `mcp_disabled` for the whole org.

Every principal must belong to an organization, a request without one is
refused. The switch is cached briefly,
but a change through `Organization.SetProfile` drops that cache at once. On a DB
blip the last cached value is served; with no cache (cold start during an
outage) it fails closed to disabled, because a switch that cannot be confirmed
must read as "off".

### RBAC

Every live call runs as the authenticated user through the normal RPC path. The
component permission decorators decide what succeeds. There is no separate MCP
permission model. Access is deny-by-default, and the level never grants more
than the user's own permissions.

### Confirmation for destructive actions

Additive writes may run immediately. Destructive writes (update, delete) require
a two-step confirm. `fm_write` returns a short-lived signed token carrying the
user, org, method, and params. At confirm time the server re-verifies every
bound field: the token must match the same user and the same organization, the
signature must be intact, and it has not expired. The token is single-use.
`fm_confirm_write` also re-runs the full write policy, so a token cannot execute
after the key's level no longer permits the write, or after the org disabled
MCP. The single-use claim is a Redis key (a digest of the token, never the
token) that lives until the token expires, so no backend instance can run a
token twice. If the claim store cannot be reached the token is refused
(`operation_unavailable`, retryable). A token issued before the claim store
last started is refused too, so a Redis restart cannot reopen a used token;
prepare it again. See "Where approval state lives".

### Automation writes need a human

A Node-RED flow runs as soon as it is saved and may use any installed node,
so creating one is not treated as a harmless additive write. These writes
always ask a human, through elicitation or the confirm token, unless a
standing approval covers them (`isAutomationWrite` in `mcpGovernance.ts`):
`automation.Graph.Create`, `automation.Graph.Update`, `automation.Create`,
`automation.Update`, `automation.SetEnabled` with `enabled: true`,
`scopedautomation.Create`, `scopedautomation.Update` and
`scopedautomation.Run`. Switching an automation off is not a start; it still
asks because the catalog marks it destructive. The refusal reason is
`starts or changes an automation`. All of these are full-level methods.

The approval text lists the flow name, node count, node types, a warning line
for nodes that run code, reach the network or touch files (`function`,
`exec`, `http request`, `http in`, `websocket`, `tcp`, `udp`, `mqtt`, `file`
and similar), addresses found in node settings and code, whether the flow
starts running, and the devices, groups, places, tags or whole fleet it
targets (`automationWriteSummary.ts`). The confirm envelope carries these
lines as `details`.

"Stop asking" works as for other approvals, with one deliberate difference in
what it covers. A create binds to no params, so one remembered yes covers every
new automation that key's user creates in that organization, whatever it
contains; the prompt says so. A change binds to the automation it touches
(`flowId`, or `id` for scoped automations), so a yes for one flow is not a yes
for another; `automation.SetEnabled` also binds `enabled`. `fm_capabilities`
returns `automationWritesNeedHuman` (the method list) and
`automationCreatesApproved` (create methods this caller already said "stop
asking" for), so an agent knows whether it will be asked.

### Elicitation and standing approvals

The confirm-token flow is the universal path; it offers a client somewhere to
show a human but cannot require it. When a client declares the `elicitation`
capability at `initialize`, the server asks directly instead.

Mechanically: `initialize` mints a session (`Mcp-Session-Id`, stored in Redis,
TTL `FM_MCP_SESSION_TTL_MIN`). On a destructive execute the route flips the open
POST to `text/event-stream`, writes an `elicitation/create` request per the MCP
spec, and awaits. The client answers with a JSON-RPC response on its own POST,
correlated by session and request id; that POST returns 202 and the held stream
carries the tool result. `settleElicitation` refuses an id nobody is waiting on,
refuses a session belonging to another principal, and treats a malformed
payload as a cancel. A client that hangs up releases its prompt at once rather
than pinning the call for the full timeout.

The requested schema stays inside the spec's flat-primitive subset, and asks
only `approve` and `remember`, never sensitive data, which the spec forbids.
Anything other than an explicit `approve: true` (decline, cancel, timeout,
malformed) is a refusal; the timeout is `FM_MCP_ELICIT_TIMEOUT_SEC`.

`remember` is a three-way choice, `always` (nothing kept), `session` (kept for
`FM_MCP_STANDING_APPROVAL_TTL_MIN`), `never` (kept for one year or until
revoked).
The permanent option exists because at the full level the operator already
holds the authority; the system records the decision instead of pretending to
know better. A legacy boolean `true` reads as the bounded scope, never the
permanent one, and no remember choice survives a refusal.

The grant is keyed on (stable user id, org, method, subject, params) whichever
scope is chosen, so the blast radius does not widen with the duration. A caller
without a user id or organization is never offered "stop asking"; a username
alone could later belong to someone else.
Automation writes bind fewer params; see "Automation writes need a human". It skips the
prompt, never the policy: RBAC, level, rate budget and audit all still run.

`mcp_approval.List` shows remembered approvals and `mcp_approval.Revoke` takes
one back. Everyone sees and revokes their own; a user who may manage the
organization settings sees and revokes every approval in that organization
(`scope: "organization"`). Another organization's id, or a colleague's for a
non-manager, revokes nothing and reveals nothing. A revoke holds on the next
call on every instance, because each check reads the shared store.

### Where approval state lives

Remembered approvals, confirmation-token claims, elicitation sessions and
pending prompts live in Redis (`fm:mcp:*`) and are shared by every backend
instance; a deployment without Redis keeps them in the process. Each key
expires with what it protects, and `FM_MCP_MAX_STANDING_APPROVALS` caps
approvals store-wide.

Failure behaviour:

- Store unreadable: approvals count as absent, so the person is asked again;
  confirmation tokens are refused.
- Redis data lost: lost approvals mean asking again. Claims lost by a Redis
  restart are covered by the start-time check above. Redis must run with
  `maxmemory-policy noeviction` (Fleet's default); an evicting policy such as
  `volatile-lru` can drop claims, because they carry a TTL.
- An elicitation answer may reach any instance; it is routed to the instance
  holding the call. If that instance restarted, the answer gets 404 and the
  action never runs.

Precedence in `resolveApproval`: standing approval, else elicitation, else the
confirm token. A `prepare` preview never prompts, preview means "show me".

### Bounded, redacted, paged reads

`fm_read` caps its output for the agent. Secrets are stripped two ways: by field
name (password, token, api_key, and similar) and by value shape, so a
secret-looking value (a private key, a JWT, an AWS or Slack or GitHub token, a
provider webhook URL) is redacted even under an innocuous key. Names follow the
shared audit rule plus pass, session, cookie, jwt, pem, ha1 and ssl_ca; a field
whose last word is psk, hmac, otp, salt or seed is hidden when its value is text
or a number; a field ending in key is hidden when its value looks like key
material (hex or base64). URL parameters with those names (`?token=`,
`access_token=`, `api_key=`) are hidden and the URL kept. Email addresses are
masked to the first letter and domain (`j***@example.com`). The row count is
capped (`FM_MCP_READ_MAX_ROWS`) and the whole envelope is byte-capped
(`FM_MCP_READ_MAX_BYTES`). When a row cap cuts a list and the method pages by
offset, the envelope returns an opaque `nextCursor`; pass it back as `cursor` on
the next `fm_read` to fetch the following page. A byte-capped result has no
cursor, narrow the query instead.

### Allowed clients

Set `FM_MCP_ALLOWED_CLIENTS` to a comma-separated allowlist of client names.
When it is set, each request must send a matching `X-MCP-Client` header. A
scoped key must also carry `mcp-client:<name>` in its audience. This binds the
client name to the key instead of trusting a caller-supplied label.

### Rate limits

There are separate per-user budgets per minute for reads and writes. Reads
default to `FM_MCP_READS_PER_MIN` (600). Writes default to
`FM_MCP_WRITES_PER_MIN` (60). The budget is a token bucket in the shared Redis
rate-limit store, so a restart does not refill it and replicas do not multiply
it; without Redis it is held in the process. A refused call gets reason
`rate_limited` (retryable). If Redis errors, calls are let through like every
other non-security limit; `rate_limit_redis_errors_total` counts it. The normal
per-method RPC rate limits still apply on top, because every live call runs
through the standard RPC path.

The budgets are sized against that RPC ceiling, not picked freely: a live call
also spends the per-user RPC budget (`rateLimitGeneralRpm` 600,
`rateLimitExpensiveRpm` 30). A lower MCP ceiling throttles an agent harder than
a plain script issuing the same calls; a higher one never binds, because the
RPC limiter trips first.

A `prepare` preview bills against the **read** budget. It runs nothing, so
planning must not exhaust the far smaller mutation budget, only `fm_write`
with mode `execute` and `fm_confirm_write` spend a write. The split lives in
`toolBudgetKind` (`backend/src/modules/ai/fleetDocsMcp.ts`).

Device commands in flight: each organization may run
`FM_MCP_DEVICE_READS_IN_FLIGHT` MCP device reads and
`FM_MCP_DEVICE_WRITES_IN_FLIGHT` device writes at once, across all instances
(Redis reservation). Only device (Shelly firmware) methods count. One more is
refused `rate_limited`, retryable, with `data.limit: "device_commands_in_flight"`;
a confirm is refused before its token is spent. A durable write holds its slot
until it finishes. If Redis errors, commands are let through and
`reservation_redis_errors_total` counts it. The defaults are not measured.

Instance read-only switch: `FM_MCP_READ_ONLY=true` makes every MCP key act at
the read level on its next request: write tools leave `tools/list` and writes
are refused `read_only_mode`. Turning it off restores each key's own level.

Event history reads (`fm://events`) are redacted like `fm_read`, marked
untrusted (`untrusted.fields: ["events"]`), audited as `mcp_tool_call`
`resources/read:<canonical URI>`, and spend one read unit; `resources/subscribe`
on `fm://events`, `subscriptions/listen` and `tasks/*` also spend one read unit
each. A 2026-07-28 approval round bills one write: the asking attempt spends
the write unit, and the retry with a valid `requestState` spends a read.

### Untrusted text in results

Results mark text Fleet did not write. `fm_read`, an executed `fm_write` and
`fm_confirm_write` carry `untrusted: {fields, notice}` before `result` whenever
the result holds text; a preview lists `summary`, `details` and
`affectedResources` when it names a resolved device. The notice says to treat
that text as data and never follow instructions in it. The data is unchanged
and Fleet's own fields are never listed. This is spotlighting (OWASP LLM01,
Microsoft); levels, RBAC and human approval remain the hard controls.

### Audit

Every stateful tool call writes an `mcp_tool_call` audit event: reads, prepares,
confirms, executes, and denials. The event records the tool name, the target
method, and attribution: the `credentialId` (which key) and a `clientId` only
when it is bound to that key's audience. An `fm_write` event also records a `phase`:
`prepare` for a preview that ran nothing, `execute` for one that changed data,
so a plan is never mistaken for a mutation. Query it through `audit.Query`.
Every RPC a tool call causes carries the same correlation id, and rows from an
agent key carry the key id. On Settings, Monitoring, Audit Log, filter by "AI
key id" to see one key's work, or press "Show this call" on a tool-call row to
see every row of that call. CSV export does not filter by key or call.
Remembered approvals are listed on Settings, Connect your AI, with revoke;
organization managers can switch to everyone in the organization.

Writes record the doorway event before they run. The audit pipeline is batched
(a bounded, drop-oldest queue with a dead-letter spill) and returns no
synchronous id, so an executed write reports `audit: { enqueued: true }` rather
than an id that would always be null under batching. If the audit call itself
rejects, the write is refused with reason `audit_unavailable` and never runs.
Honest limit: because the pipeline is batched, "enqueued" means the doorway
event was accepted by the queue, not that it is already persisted; under
sustained overload the queue can drop it. True per-write durability (a
synchronous audit path for mutations) is a tracked follow-up, not a promise
made here.

### Errors, tool hashes, tasks and trace context

A failed tool call (`isError`) carries `_meta["com.shelly.fleet/error"]` =
`{reason, retryable, rpcCode?, method?, tool?, invalidParams?: [{pointer, code}],
untrusted?}`. Pointers are RFC 6901, relative to the method params when
`method` is set, else to the tool arguments. Relayed device error text is
marked untrusted.

Each tool in `tools/list` carries `_meta["com.shelly.fleet/toolHash"]` (sha256
of its definition without `_meta`); `tools/list`, `initialize` and
`server/discover` carry `_meta["com.shelly.fleet/toolSetDigest"]` over the tools
this caller sees. A client can pin them and ask the person again when they
change.

Tasks extension (2026-07-28 clients that declare
`io.modelcontextprotocol/tasks`): a durable `fm_write` or `fm_confirm_write`
(with `idempotencyKey`) that is still running returns a task whose `taskId` is
the operation id. `tasks/get` answers `working` or `completed`; a write that did
not succeed completes with `isError`. `tasks/cancel` is acknowledged but does
not stop a dispatched write; `tasks/update` is acknowledged, there is never
pending input. No `notifications/tasks`; poll at `pollIntervalMs`.

Trace context: `_meta.traceparent`/`tracestate`, or the HTTP headers, are
validated per W3C Trace Context. The trace id is logged with the call's
correlation id and stored on the `mcp_tool_call` audit row (`params.traceId`).
With an OTLP collector configured (`OTEL_EXPORTER_OTLP_ENDPOINT` or
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`), every MCP request also exports one
OpenTelemetry span (see `docs/reference/observability.md`).

## Configuration

Every limit is environment-driven and hot-readable, so ops can flip it
mid-process (incident response). The capability level is not set here, it lives
on each key's `mcp` scope, gated by the user's own permissions.

| Env var | Default | Effect |
|---|---|---|
| `FM_MCP_ALLOWED_CLIENTS` | (empty) | Comma-separated client allowlist; empty allows all. Scoped keys also need a matching `mcp-client:<name>` audience entry. |
| `FM_MCP_READS_PER_MIN` | `600` | Per-user budget for read-toolset calls and `fm_write` previews, per minute. |
| `FM_MCP_WRITES_PER_MIN` | `60` | Per-user budget for calls that actually change data, per minute. |
| `FM_MCP_READ_MAX_ROWS` | `200` | `fm_read` list row cap before truncation and a `nextCursor`. |
| `FM_MCP_READ_MAX_BYTES` | `262144` | `fm_read` envelope hard byte cap. |
| `FM_MCP_ELICIT_TIMEOUT_SEC` | `120` | Wait for a human answer before treating it as cancelled. |
| `FM_MCP_SESSION_TTL_MIN` | `60` | Idle life of an elicitation session. |
| `FM_MCP_MAX_SESSIONS` | `500` | Concurrent elicitation sessions. |
| `FM_MCP_STANDING_APPROVAL_TTL_MIN` | `60` | Life of a remembered approval. |
| `FM_MCP_MAX_STANDING_APPROVALS` | `1000` | Remembered approvals held at once. |
| `FM_MCP_READ_ONLY` | `false` | Every MCP key acts at the read level while on. |
| `FM_MCP_DEVICE_READS_IN_FLIGHT` | `16` | Device (Shelly firmware) reads running at once per organization. |
| `FM_MCP_DEVICE_WRITES_IN_FLIGHT` | `4` | Device writes running at once per organization. |
| `FM_MCP_DEVICE_COMMAND_SLOT_TTL_SEC` | `300` | Life of a device-command slot that is never given back. |
| `FM_MCP_AUTH_RETRY_AFTER_SEC` | `5` | `Retry-After` on a 503 when Zitadel cannot be reached. |

Per tenant, in the org profile (`metadata.mcpPolicy`), `enabled: false` turns
MCP off for the whole org. The capability level is not here, it lives on each
key's `mcp` scope. A change through `Organization.SetProfile` takes effect at
once.

## MCP-native annotations

Each tool carries the standard MCP `ToolAnnotations` hints, so any MCP client
can understand the risk before it calls:

- `readOnlyHint`: the tool does not change state.
- `destructiveHint`: the tool may delete or overwrite data.
- `idempotentHint`: calling the tool again with the same input has the same
  effect.
- `openWorldHint`: the tool reaches beyond the server's own state.

These are hints for the client. The server still enforces everything
independently. A client that ignores an annotation gains nothing: the capability
level, the permission decorators, the confirmation step, and the rate limits
still apply.

## Reason codes

Every governance refusal carries a stable `reason` on the JSON-RPC error `data`,
so an agent branches on the code, not the human sentence. The codes:
`method_not_found`, `method_not_read_only`, `method_not_write`,
`namespace_not_allowed`, `escape_hatch`, `effect_depends_on_input`,
`sensitive_namespace`, `read_only_mode`, `mcp_disabled`,
`client_not_allowed`, `rate_limited`, `invalid_params`,
`invalid_confirmation`, `audit_unavailable`, and `unknown_tool`. Each error also
carries `retryable`, and `tool`/`method` when known. The human message stays for
logs.

Two failures arrive by a different path and carry no MCP `reason` body: an
unauthenticated request is a plain 401 `Unauthorized`, and an RBAC denial is the
underlying RPC `PermissionDenied` error, the permission decision is made by the
component decorators, not a separate MCP code.

## Structured output

`get_api_method`, `fm_read`, `fm_write`, and `fm_confirm_write` return
`structuredContent` (the same object as the text body) and advertise an
`outputSchema` in `tools/list`, so a client validates a typed result instead of
reparsing text. The text content stays for older clients.

## Two transports, one core

The same read and operate logic serves both transports from one core
(`backend/src/modules/ai/fleetDocsMcp.ts`):

- **Local stdio server.** `backend/scripts/fleet-docs-mcp-server.mjs`, wired in
  `.mcp.json`. Documentation and lookup only.
- **Live-instance HTTP endpoint.** Streamable HTTP at `POST /mcp`, one JSON-RPC
  message per request, answered with a JSON-RPC response, or with an SSE
  stream when the call needs to elicit (below).

Live write tools require the HTTP route. They need the authenticated user, which
only the HTTP route supplies. The stdio server has no user, so it stays
documentation-only.

### Transport limits

The HTTP transport is deliberately narrow, so every call carries exactly one
auth and budget decision:

- One JSON-RPC message per POST, at most 4 MB. Bad JSON gets 400 and -32700;
  a body over the limit gets 413 and -32600. A batch, a missing or null id on a
  request, or a missing `jsonrpc: "2.0"` gets 400 and -32600.
- Notifications return 202.
- A request on an ended or expired session gets 404 and -32001; initialize
  again. If the session store cannot answer, the reply is 503 (retryable).
  Sessions count against `FM_MCP_MAX_SESSIONS`.
- `GET /mcp` without a session, or on a session without an event stream, gets
  405. A late elicitation answer gets 400; the session continues.
- Errors: -32602 for invalid params or an unknown tool, -32002 for an unknown
  resource, -32603 for an internal error, -32000 for governance refusals;
  `data.reason` is always present. Bad tool arguments come back as a tool
  result with `isError` and `reason: "invalid_params"`.
- `notifications/cancelled` stops `tools/call` and `resources/read` on a
  session, on any instance. No response is sent and a pending approval prompt
  is withdrawn. A write that has not started will not start; a device RPC
  already in flight cannot be recalled.
- `logging` is declared with the event stream; `logging/setLevel` is accepted.
- Prompt arguments: declared names only, strings up to 500 characters, no
  invisible control or format characters; values are inserted as quoted
  strings.
- Tool definitions carry their toolset in `_meta["com.shelly.fleet/toolset"]`.
- Authenticated `GET /mcp` streams resource-change notifications for a durable
  session. Keep the `Mcp-Session-Id` returned by initialization.
- Subscriptions, retained notification frames, sessions and pending
  elicitations live in Redis. The held call itself stays with its process and
  fails closed after a restart.
- A request without `Origin` is allowed (a key is still required). A request
  with `Origin` must match the origin of `FM_PUBLIC_BASE_URL`; when that is
  empty, it is refused with 403. The Host header is never trusted.
- Protocol versions over HTTP: 2026-07-28 (stateless) and 2025-11-25,
  2025-06-18, 2025-03-26 (session revisions); 2024-11-05 is stdio only.
  `PROTOCOL_REVISIONS` in `fleetDocsMcp.ts` is the one table. An unknown
  `MCP-Protocol-Version` gets 400 with -32022 and `data.supported`.
- The server does not push tool-list-changed notifications yet.
- `initialize` agrees only to a session revision, newest `2025-11-25`.

### Stateless mode (2026-07-28)

A request whose `_meta` names 2026-07-28 is stateless; anything else follows
the session rules above. There is no `initialize` and no `Mcp-Session-Id`
(ignored, never minted). Every request needs `_meta`
`io.modelcontextprotocol/protocolVersion` and `clientCapabilities` (else 400,
-32602) and matching `MCP-Protocol-Version`, `Mcp-Method` and, for
`tools/call`, `resources/read` and `prompts/get`, `Mcp-Name` headers (else 400,
-32020). `server/discover` lists versions and capabilities. Results carry
`resultType` and `_meta.serverInfo`; lists carry `ttlMs` (300000; event reads
0) and `cacheScope` (private, except `prompts/list`). An unknown resource is
-32602; an unknown method is 404, -32601. `ping`, `logging/setLevel`,
`resources/subscribe`, GET and DELETE do not exist. Closing the response stream
cancels the request. Every gate (MCP credential, level, role, tenant switch,
client allow-list, rate budget, audit) runs on every request.

Approvals use Multi Round-Trip Requests. A client that declares form
elicitation gets `resultType: "input_required"` with one `elicitation/create`
under `fleet_approval` and a `requestState`; it repeats the same call with
`inputResponses` and the state. The state is signed, bound to the key, the
exact call and the prompt, valid for `FM_MCP_ELICIT_TIMEOUT_SEC`, and used
once (Redis claim); anything else gets -32602 `invalid_request_state`. Without
form elicitation the confirm-token flow applies.

`subscriptions/listen` takes `notifications.resourceSubscriptions` with up to 32
`fm://events` URIs. The stream starts with
`notifications/subscriptions/acknowledged`; every message carries
`_meta["io.modelcontextprotocol/subscriptionId"]` (the request id); updates are
`notifications/resources/updated`, and reading the URI returns records and any
history gap. Resume with the `cursor=` URI from the last read. A stream counts
against `FM_MCP_MAX_SESSIONS`, ends with a JSON-RPC error when the key,
organization switch or a permission stops admitting it, and with a `complete`
result when the server shuts down.

### Job control and event history

Read `Job.Capabilities` before requesting `Job.Cancel` or `Job.Resume` through
the governed write tools. Backup, firmware, certificate and credential controls
stop undispatched work and require the full MCP level with access to all four
job namespaces. They
resume only work known not to have been dispatched. An unresolved device
effect is never automatically replayed. Cancellation does not undo completed
work or stop a command already executing on a device. `Job.Get.control` separates
queued, claimed, dispatched, stopped and unresolved units; the existing job
status remains compatible. `fm_reconcile_operation` uses this evidence when
offering recovery actions.

Read `fm://events` through `resources/read`. Filter with `?deviceId=...` or
`?groupId=...` or `?jobId=...` and follow `nextUri`. Feed cursors are signed and bound to the
tenant, user, credential and filters. Each page checks current resource access.
The journal records job changes in the same database transaction. Device
observations contain event metadata and are best effort: a failed capture is
counted by `mcp_event_journal_device_capture_dropped`, while normal device
broadcasts continue. Group create/update/delete and membership-count changes,
plus device inventory create/update/delete, are also captured on a best-effort
basis. Resource capture failures increment
`mcp_event_journal_resource_capture_dropped`. Group rows require current
`Group.Get` access. Deleted-resource history stays stored but becomes hidden
when its current resource lookup fails. This is not an archive of every event.
Migration 20099 rollback retains group history under unvalidated legacy checks;
new group writes stop until the migration is reapplied.

Subscribe using `resources/subscribe` with the canonical resource URI, then
open the authenticated GET stream. A `notifications/resources/updated` message
contains the subscribed URI; read the resource to retrieve authorized records.
Reconnect with the same session and `Last-Event-ID`. The transport ID is
separate from the feed cursor and belongs to one stream. A missing retained
range produces an explicit history gap. Delivery can repeat; use event IDs
for deduplication. Client-side model wake-up is not guaranteed by notifications.

History is capped at 100,000 rows per tenant, with bounded cleanup of rows older
than seven days. A session allows 32 subscriptions and retains 256 notification
frames. Credential reauthentication, current permissions and tenant policy
apply during streaming and replay. Clients without streaming can keep polling
the resource. Native experimental MCP task APIs are not advertised.

### Scoped automation and graph validation

`scopedautomation.Create/Get/List/Update/Delete` manages fixed-device schedules.
Creation uses a caller-supplied UUID `idempotencyKey`; updates and deletion use
`expectedRevision`. The original tenant, user and credential own the record.
The engine graph is compiled by the server. Its execution token is stored as a
hash in Fleet and omitted from scoped read responses. MCP writes require the
full level; the `automation_admin` role includes this namespace.

`ScopedAutomation.Run` checks the originating user's current account state,
membership, credential and target permissions. The account state comes from
the identity provider on every run: a user deactivated, locked or deleted in
Zitadel stops all later runs, even though Zitadel keeps that user's
organization and grants. Durable jobs use the same check. If the identity
provider cannot be reached, the run is refused and its receipt is settled
as denied, so later firings can run again once it is back. The engine's service credential authenticates
the callback; device actions run with the original author's authority. Node-RED
needs the Fleet node package, `FM_BASE_URL`, and a valid
`FM_NODE_RED_SERVICE_TOKEN` for normal RPC access. An MCP-only credential cannot
serve as that engine credential. Arbitrary graph/editor access retains its
existing tenant-wide permission rule.

A deployment failure leaves a disabled draft. An interrupted execution remains
unknown and is not automatically replayed. This does not provide a way to undo
a device command or universal cancellation of arbitrary engine code.
Separate timer firings reuse the execution token and carry distinct
`invocationId` values from Node-RED message IDs. Device replies are redacted before return and durable storage. A durable receipt binds each ID
to its automation and token generation. Completed retries return the saved
result after rechecking the author's access. Pending or unknown executions
block further dispatch; completed device commands cannot be undone.

Receipts remain until the automation is deleted, so expiry cannot accidentally
enable a duplicate. Older flows without `invocationId` share one legacy receipt
per token generation and execute at most once. Update each older schedule once
to deploy the new message-ID wiring and resume repeated scheduling.

`automation.Graph.Validate` returns additive `coverage` metadata. Rules check
configuration references, fields, wire targets and subflow interfaces.
Retained global configurations are available while validating a local flow.

Node properties of every installed type, third-party packages included, are
checked against the editor definitions the running Node-RED reports. The Fleet
Node-RED package serves them at
`<adminRoot>/fleet-manager-node-red/node-definitions` (Node-RED permission
`nodes.read`). Fleet applies the editor's own rules: required values, number
and pattern validators, typed JSON and number values, config references and
output counts; environment references such as `${PORT}` are accepted. Fleet
adds its own checks for Fleet nodes. Graph.Create and Graph.Update apply the
same checks.

`coverage.definitionSource` is `installed-node-red` or `unavailable` (older
package, or Node-RED could not describe its nodes; only Fleet's built-in rules
ran). `coverage.uncheckedProperties` names, per type, properties whose editor
validator Fleet cannot run: custom validator functions and message, context or
JSONata typed values. Fleet never evaluates editor JavaScript; Node-RED loads
its installed definitions in an isolated context to describe them. The rules
follow [Node-RED property definitions](https://nodered.org/docs/creating-nodes/properties)
and [graph types](https://nodered.org/docs/api/admin/types).

## Example: create an alert for offline devices

1. The agent calls `fm_read` to list devices and find the offline ones.
2. The agent calls `fm_write` with method `alert.Rule.Create` and mode
   `prepare`. It gets back a summary, the required permission `alerts/create`,
   and a confirmation token. Nothing has run yet.
3. The agent, or a human reviewing the plan, confirms by calling
   `fm_confirm_write(token)`. The rule is created. The response returns the
   result and `audit: { enqueued: true }`.

## What is never exposed, at any level

These are structural, even the `full` level cannot reach them, because MCP
proxies governed Fleet Manager methods and is not a raw RPC pipe:

- **Raw dispatchers**: `script.Eval`, and methods whose effect depends on
  input (`effectDependsOnInput`). These cannot be previewed, so a human
  cannot be shown what they would do.

`device.Call` is not refused: it is unwrapped into the method it names, and
that method is then judged on its own merits. The caller gains nothing it
could not already do, and an inner name the catalog does not know is refused.

**Device firmware methods are reachable at `full`.** They are a capability of
that level, not a structural exclusion: they carry real schemas and safety
flags, so they preview and confirm like any other write, and below `full` they
are refused `namespace_not_allowed`. A key scoped `mcp:full` can drive
`Switch.Set` and `Shelly.Reboot`, scope keys accordingly.

Sensitive namespaces (credentials, backup, users, …) are likewise gated by the
capability level rather than excluded, and are reachable only at `full`. Call
`fm_capabilities` to see the exact list your key faces.

## Regenerate and verify

The API surface is generated by `npm run generate` and checked by
`npm run generate:gates`. This doc is hand-maintained.
