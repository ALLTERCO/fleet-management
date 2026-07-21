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
   immediately. Destructive writes (update, delete) come back as
   `confirmation_required` with a token. Call `fm_confirm_write(token)` to run
   the exact reviewed action.
5. **Audit.** Every stateful tool call is logged as an `mcp_tool_call` audit
   event with the user, the method, whether it succeeded, and the error reason
   if it failed. Query it through `audit.Query`.

## Tools

| Tool | Toolset | Read-only | What it does |
|---|---|---|---|
| `read_resource_chunk` | docs | yes | Read a bounded part of a listed MCP resource. Use `nextOffset` for the next part. |
| `search_docs` | docs | yes | Search the small AI-indexed Fleet Manager docs. |
| `get_api_method` | docs | yes | Look up one method: namespaceKind, schemas, permission, safety hints, recommended Host SDK wrapper. Prefer this. |
| `get_rpc_method` | docs | yes | Exact RPC inventory lookup: declaration provenance and source. |
| `find_frontend_callers` | docs | yes | Find UI callers before changing a backend contract. |
| `fm_read` | read | yes | Run any Fleet Manager read-only method as the authenticated user. |
| `list_devices` | read | yes | Named convenience wrapper. Lists fleet devices (slim, capability-filtered). |
| `read_energy` | read | yes | Named convenience wrapper. Queries aggregated energy history for a scope. |
| `fm_write` | write | no | Run a Fleet Manager write the level permits. Has `mode` `prepare` or `execute`. |
| `fm_confirm_write` | write | no | Execute the exact write a token was issued for. |

## Governance

The design follows the same patterns other MCP servers use. GitHub's MCP
server groups tools into toolsets and offers a read-only mode. Atlassian's Rovo
MCP gates access with OAuth, RBAC, audit logging, and an allowed-clients list.
Fleet Manager applies the same ideas, enforced server side.

### Toolsets

Tools are grouped like GitHub's MCP toolsets, and each group is gated
differently:

- **docs** — `read_resource_chunk`, `search_docs`, `get_api_method`, `get_rpc_method`,
  `find_frontend_callers`. They change no state. Local stdio needs no auth; the
  live HTTP endpoint always requires auth.
- **read** — `fm_read`, `list_devices`, `read_energy`. Appear only on an
  authenticated request; they run real read-only RPCs as the user.
- **write** — `fm_write`, `fm_confirm_write`. Appear only with auth, and only
  when the key's level allows writes.

A **read** key drops the whole write group; a disabled tenant drops everything;
a **full** key also opens the sensitive namespaces. The control is the key's
level (`read` / `write` / `full`) plus the org `enabled` switch, not a
per-toolset selection.

### Authentication and access

The `/mcp` route is login-gated with `isLoggedIn`; unauthenticated agents get a
JSON 401, not a browser redirect. Access is then gated by `requireMcpAccess`,
which admits two kinds of principal:

- an **admin** — an admin browser session or an admin key (`isAdmin` — the
  `admin` role or the `*` permission), or
- a **key scoped for MCP** — a scoped PAT whose `audience` carries an `mcp`
  scope (see below), even if that key itself is not admin.

Everything else is refused. A scoped key is minted by an admin and can only
narrow, so it is admin-authorized either way.

### Connecting an agent — scoping a key for MCP

The industry pattern (GitLab, GitHub, Stripe): a machine identity whose token is
scoped down. Here:

1. **Make a service user and give it an admin role.** MCP runs as this user, so
   its permissions are the ceiling for what the agent can do (RBAC).
2. **Mint a scoped key for it** with `User.CreateScopedPAT`, and put an `mcp`
   scope in its `audience`: `mcp:read`, `mcp:write`, or `mcp:full`. That single
   scope both marks the key for MCP and sets its level — the same way GitLab
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

An admin browser session may also call `/mcp` directly (no key) and gets `full`.
In local dev (`FM_DEV_MODE=true`) the admin token comes from `User.Authenticate`
with `admin`/`admin`.

An MCP-scoped key is accepted only at `/mcp`. Normal `/rpc` and `/api` routes
reject it. Invalid MCP scopes also fail closed.

### Capability levels

The level lives on the key (its `mcp` scope), not on the org. Bare `mcp` is
`read`. The level plus RBAC decide what the agent may do:

- **read** — reads only. Write tools are hidden and refused.
- **write** — reads plus any non-sensitive write. Sensitive namespaces
  (credentials, firmware, backup, users, …) stay off.
- **full** — anything the user can do, sensitive namespaces included.

The level only caps how much of the user's power is exposed; RBAC still runs
every call as the user, so MCP can never exceed what that user is allowed to do
in the app. Destructive writes still need the confirm step, and every call is
audited, at every level.

Three refusals are structural and apply at every level, because MCP proxies
governed Fleet Manager methods and is not a raw RPC pipe: device firmware
methods (namespaceKind `device`), raw escape hatches (`device.Call`,
`script.Eval`), and methods whose effect depends on input.

### Per-tenant switch

The level is on the key, so the org profile holds only an on/off switch, in
`metadata.mcpPolicy` — no new table — read via `Organization.GetProfile` and
cached briefly:

- `enabled: false` → `/mcp` returns 403 `mcp_disabled` for the whole org.

Every principal must belong to an organization — a request without one is
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
MCP. Single-use
claims are held in process memory today, which matches the current topology of
one Fleet Manager backend instance per client. A durable store is only needed if
one client can be served by multiple backend instances, or if replay protection
must survive process restarts.

### Bounded, redacted, paged reads

`fm_read` caps its output for the agent. Secrets are stripped two ways: by field
name (password, token, api_key, and similar) and by value shape, so a
secret-looking value (a private key, a JWT, an AWS or Slack or GitHub token, a
provider webhook URL) is redacted even under an innocuous key. The row count is
capped (`FM_MCP_READ_MAX_ROWS`) and the whole envelope is byte-capped
(`FM_MCP_READ_MAX_BYTES`). When a row cap cuts a list and the method pages by
offset, the envelope returns an opaque `nextCursor`; pass it back as `cursor` on
the next `fm_read` to fetch the following page. A byte-capped result has no
cursor — narrow the query instead.

### Allowed clients

Set `FM_MCP_ALLOWED_CLIENTS` to a comma-separated allowlist of client names.
When it is set, each request must send a matching `X-MCP-Client` header. A
scoped key must also carry `mcp-client:<name>` in its audience. This binds the
client name to the key instead of trusting a caller-supplied label.

### Rate limits

There are separate per-user budgets per minute for reads and writes. Reads
default to `FM_MCP_READS_PER_MIN` (60). Writes default to
`FM_MCP_WRITES_PER_MIN` (10). The normal per-method RPC rate limits still apply
on top, because every live call runs through the standard RPC path.

### Audit

Every stateful tool call writes an `mcp_tool_call` audit event: reads, prepares,
confirms, executes, and denials. The event records the tool name, the target
method, and attribution: the `credentialId` (which key) and a `clientId` only
when it is bound to that key's audience. An `fm_write` event also records a `phase`:
`prepare` for a preview that ran nothing, `execute` for one that changed data,
so a plan is never mistaken for a mutation. Query it through `audit.Query`.

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

## Configuration

Every limit is environment-driven and hot-readable, so ops can flip it
mid-process (incident response). The capability level is not set here — it lives
on each key's `mcp` scope, gated by the user's own permissions.

| Env var | Default | Effect |
|---|---|---|
| `FM_MCP_ALLOWED_CLIENTS` | (empty) | Comma-separated client allowlist; empty allows all. Scoped keys also need a matching `mcp-client:<name>` audience entry. |
| `FM_MCP_READS_PER_MIN` | `60` | Per-user budget for read-toolset calls per minute. |
| `FM_MCP_WRITES_PER_MIN` | `10` | Per-user budget for write-toolset calls per minute. |
| `FM_MCP_READ_MAX_ROWS` | `200` | `fm_read` list row cap before truncation and a `nextCursor`. |
| `FM_MCP_READ_MAX_BYTES` | `262144` | `fm_read` envelope hard byte cap. |

Per tenant, in the org profile (`metadata.mcpPolicy`), `enabled: false` turns
MCP off for the whole org. The capability level is not here — it lives on each
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
underlying RPC `PermissionDenied` error — the permission decision is made by the
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
- **Live-instance HTTP endpoint.** Stateless Streamable HTTP at `POST /mcp`,
  one JSON-RPC message per request, answered with a JSON-RPC response.

Live write tools require the HTTP route. They need the authenticated user, which
only the HTTP route supplies. The stdio server has no user, so it stays
documentation-only.

### Transport limits

The HTTP transport is deliberately narrow, so every call carries exactly one
auth and budget decision:

- One JSON-RPC message per POST. Batch arrays are refused with 400.
- Notifications (no `id`) return 202.
- `GET /mcp` returns 405; there is no SSE stream.
- Browser `Origin` must match `FM_PUBLIC_BASE_URL`, or the request host when
  that variable is empty.
- Supported `MCP-Protocol-Version` values are validated.
- The server does not push tool-list-changed notifications yet.
- `initialize` reports protocol version `2025-11-25`.

## Example: create an alert for offline devices

1. The agent calls `fm_read` to list devices and find the offline ones.
2. The agent calls `fm_write` with method `alert.Rule.Create` and mode
   `prepare`. It gets back a summary, the required permission `alerts/create`,
   and a confirmation token. Nothing has run yet.
3. The agent, or a human reviewing the plan, confirms by calling
   `fm_confirm_write(token)`. The rule is created. The response returns the
   result and `audit: { enqueued: true }`.

## What is never exposed, at any level

These are structural — even the `full` level cannot reach them, because MCP
proxies governed Fleet Manager methods and is not a raw RPC pipe:

- **Device firmware methods** (namespaceKind `device`). Anything that talks to
  Shelly firmware directly.
- **Raw tunnels and dispatchers**: `device.Call`, `script.Eval`, and methods
  whose effect depends on input (`effectDependsOnInput`).

Sensitive namespaces (credentials, firmware, backup, users, …) are not in this
list: they are gated by the capability level, reachable only at `full`.

## Regenerate and verify

The API surface is generated by `npm run generate` and checked by
`npm run generate:gates`. This doc is hand-maintained.
