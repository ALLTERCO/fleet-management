## Overview

The method field of all the requests is not case-sensitive.

## Authentication

Fleet Manager uses **Zitadel** for authentication. To access the API programmatically, you need a **Personal Access Token (PAT)**.

### Creating a Personal Access Token

1. Log into the Zitadel Console (e.g., `https://<YOUR_ZITADEL_HOST>/ui/console/`)
2. Go to **Users**
3. Click **Service Users** tab
4. Click **New** to create a new service user:
   - Enter a username (e.g., `api-service`)
   - Enter a name/description
   - Click **Create**
5. After creation, go to the service user's detail page
6. Navigate to **Authorizations** tab and grant access to the Fleet Manager project with appropriate roles (e.g., `admin`, `viewer`, `installer`)
7. Navigate to **Personal Access Tokens** tab
8. Click **New** to create a token
9. Set an optional expiration date
10. Click **Create** and **copy the token immediately** (it won't be shown again)

### Using the Token

Include the token as a Bearer token in the `Authorization` header for all API requests:

```bash
Authorization: Bearer <YOUR_PAT>
```

#### Example

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Device.List","params":{},"id":1}'
```

## RPC Endpoints

The primary HTTP RPC endpoint is:

```bash
POST https://<YOUR_HOST>/rpc
```

The request body must be a JSON-RPC 2.0 object with the following structure:

```json
{
  "jsonrpc": "2.0",
  "method": "<Component.Method>",
  "params": { ... },
  "id": 1
}
```

Additional HTTP RPC helpers are also live:

- `POST /rpc/:method` — authenticated; request JSON body becomes `params`
- `POST /rpc` — primary endpoint; in `DEV_MODE`, `User.Authenticate` and `User.Refresh` are allowed before login

`GET /rpc/:method` is intentionally NOT supported — query-string params under cookie auth would let any logged-in browser execute mutations via an `<img src>` exploit. The path responds `405 Method Not Allowed` with `Allow: POST`.

For HTTP transport, successful responses return the unwrapped `result` value directly. Error responses return the backend JSON-RPC error object or envelope produced by the handler.

## WebSocket Transport

The authenticated client WebSocket endpoint is the root path of your Fleet
Manager domain:

```text
wss://<YOUR_HOST>/
```

Do **not** use `/rpc` (HTTP JSON-RPC), `/shelly` (device connection path), or
`/ws/v2` (not mounted).

Use the same Personal Access Token (PAT) as the HTTP API. Browser clients
should pass it as the WebSocket subprotocol:

```js
const ws = new WebSocket('wss://<YOUR_HOST>/', '<YOUR_PAT>');
```

Node clients may also pass the standard authorization header:

```js
const ws = new WebSocket('wss://<YOUR_HOST>/', {
  headers: { Authorization: 'Bearer <YOUR_PAT>' }
});
```

If the token is missing, the upgrade is rejected with HTTP `401 Unauthorized`.
If the token is invalid after the socket opens, the server closes the socket
with code `4401`.

Every WebSocket RPC message sent to Fleet Manager should include `src` and
`dst: "FLEET_MANAGER"`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "src": "my-client",
  "dst": "FLEET_MANAGER",
  "method": "System.Subscribe",
  "params": { "events": ["Shelly.Status"] }
}
```

The server sends heartbeat pings every `FM_WS_HEARTBEAT_MS` ms (default 30000).
Standard WebSocket clients such as the `ws` package answer pongs automatically.

The server tolerates up to `FM_WS_HEARTBEAT_MISSED_PONGS_MAX` (default 2)
consecutive missed pongs before terminating the socket. If RPCs are in flight
when a pong is missed the server grants one extra heartbeat cycle before
disconnecting, giving slow in-flight calls a chance to complete.

### Reconnection

Subscriptions are tied to a single WebSocket session. When the socket closes
(network drop, server restart, idle timeout), the server forgets the
subscription IDs that were tied to it. Clients must:

1. Reconnect the WebSocket (with backoff — start at 1s, double up to ~30s).
2. Re-issue any `System.Subscribe` calls. The new IDs are unrelated to the
   old ones.
3. Resume normal operation. Events that fired during the disconnect are not
   replayed — query current state via `Device.List`, `Entity.List`, etc. as
   needed.

```js
const PAT = '<your PAT>';
let backoff = 1000;

function connect() {
    const ws = new WebSocket('wss://<YOUR_HOST>/', PAT);

    ws.on('open', () => {
        backoff = 1000;
        ws.send(JSON.stringify({
            jsonrpc: '2.0', id: 1, src: 'my-client', dst: 'FLEET_MANAGER',
            method: 'System.Subscribe',
            params: { events: ['Shelly.Connect', 'Shelly.Disconnect', 'NotifyStatus'] }
        }));
    });

    ws.on('close', () => {
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
    });
}
connect();
```

A close code of `4401` means the token was rejected — reconnecting with the
same token will keep failing. Refresh credentials before retrying.

## API Surface

Three entry points for device-side operations. Pick the one that matches what you're doing:

| Use this | When |
| --- | --- |
| **`Entity.InvokeAction`** | You're performing a typed action on an existing entity — `toggle`, `open`, `setBrightness`, `mute`, `capture`, `setArmed`, `playPause`, etc. Takes `{id, action, params}` where `id` is the **entity id**; the backend resolves the device + channel + firmware method. Per-action param schema validation. Permission is `devices:execute` scoped to the resolved shellyID. Audit rows carry `Entity.InvokeAction` with the `action` name in the params. **This is the primary path for UI-driven operations.** |
| **Canonical namespace methods** | You're performing a vendor-specific per-device operation that isn't an entity action — config reads/writes on a firmware component, creation/management ops, admin flows. Examples: `BTHome.Sensor.Add`, `BTHome.Device.AddManual`, `Cury.SetConfig`, `Matter.GetSetupCode`, `Pill.GetConfig`, `Camera.AddZone`, `Thermostat.Create`, `Trv.SetConfig`, `Virtual.Add`, `Ui.SetConfig`, etc. Each takes `{shellyID, ...}`. Per-method typed schema, per-method permission (`devices:read` / `update` / `execute` / `delete` depending on op), method-named audit row. |
| **`Device.Call`** | You're sending a **raw firmware RPC** — admin debugging, Actions Tab, or testing new firmware methods before backend-typed wrappers exist. Takes `{shellyID, method, params}` and forwards verbatim to the device. Generic `devices/execute` permission, envelope validation only, no per-method schema. **Not intended for product flows.** |

**`Device.*`** itself is the fleet-entity primitive surface — `Device.Describe`, `Device.List`, `Device.Get`, `Device.GetInfo`, `Device.GetSetup`, `Device.GetDeviceChannels`, `Device.GetStatusHistory`, `Device.GetStatusTimeline`, `Device.Delete`, and `Device.Call` (escape hatch for raw firmware RPC). Device-level actions like reboot, factory reset, firmware update, and profile management live in the `Shelly.*` namespace (see §36). Per-component operations do **not** live on `Device.*` — they live in their canonical namespace.

### Fleet and server namespaces

Operations that aren't per-device stay in their own namespaces:
`Firmware.*`, `Backup.*`, `Alert.*`, `Notification.*`,
`notification_policy.*`, `Dashboard.*`, `Group.*`, `Location.*`,
`Tag.*`, `user_group.*`, `Energy.*`, `Report.*`, `Webhook.*`,
`Policy.*`, `permission.*`, `Persona.*`,
`Assignment.*`, `Variables.*`, `Storage.*`,
`Kvs.*`, `WaitingRoom.*`, `Schedule.*`, `User.*`, `Organization.*`,
`Identity.*`, `Branding.*`, `Privacy.*`, `Restrictions.*`,
`domain_policy.*`, `login_text.*`, `message_text.*`, `Certificate.*`,
`Credential.*`, `Admin.*`, `Audit.*`, `authz_audit.*`, `fleet.*`,
`System.*`, `Plugin.*`, `Mail.*`, `Mobile.*`,
`Entity.*` (beyond `InvokeAction` — `List`, `Get`, `GetCapabilities`,
`GetActionSchema`).

### Inherited methods

Every namespace inherits a small set of dispatcher-level methods from
the Component base class that are not declared in the per-namespace
manifest:

| Method | Purpose |
|--------|---------|
| `<ns>.ListMethods` | Enumerates the namespace's method names. |
| `<ns>.GetConfig` | Reads the namespace's persistent config. |
| `<ns>.GetStatus` | Reads the namespace's runtime status. |
| `<ns>.SetConfig` | Writes the namespace's persistent config (write permission). |

These are NOT rendered in the per-namespace reference below — only
methods registered via `DescribeBuilder.registerMethod` appear. See
[docs/generated/backend-rpc-inventory.md](backend-rpc-inventory.md) for
the full dispatcher view including inherited methods.

## Standard List Response

List/collection methods return a consistent collection object. Over WebSocket JSON-RPC this is the method `result`; over HTTP `/rpc` the transport unwraps that `result` and returns the object directly:

```json
{
  "items": [...],
  "total": 5000,
  "limit": 500,
  "offset": 0,
  "has_more": true
}
```

- `items` — the collection array (per [Google JSON Style Guide](https://google.github.io/styleguide/jsoncstyleguide.xml) reserved name)
- `total` — total items matching the query (per [Shelly Gen2 RPC convention](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Shelly/))
- `offset` — index of the first item in this page (per Shelly convention)
- `limit` — page size applied (0 = unlimited). Echoed so callers know the default when they didn't specify one.
- `has_more` — `true` if `offset + items.length < total`. Convenience boolean to avoid off-by-one pagination bugs.

To paginate, increment `offset` by `limit` until `has_more` is `false`:

```json
{"method": "Device.List", "params": {"limit": 100, "offset": 0}}
{"method": "Device.List", "params": {"limit": 100, "offset": 100}}
{"method": "Device.List", "params": {"limit": 100, "offset": 200}}
```

Set `limit: 0` to disable pagination and return all items in one response.

## Errors

Every error response uses the JSON-RPC 2.0 envelope. The HTTP `/rpc`
transport sets the HTTP status per the tables below; on WebSocket the
JSON-RPC envelope is the only error signal — the connection stays open.

### Canonical shape

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": 1000,                       // stable application code
    "message": "Request params failed validation",
    "data": {
      "type": "validation",             // high-level category
      "operation": "Group.Create",      // namespace.method that failed
      "fieldErrors": [                  // multi-field validation
        {"field": "name", "code": "required",   "error": "required"},
        {"field": "kind", "code": "enum",       "error": "must be one of [device,user]"}
      ],
      "requestId": "rpc-l5x9k0-7"       // log correlation id
    }
  }
}
```

`data` is always set on errors raised by the dispatcher. Every key is
stable across versions; clients can switch on whichever is most useful.

| Key | Type | When set |
| --- | --- | --- |
| `type` | enum | Always. High-level category — see table below. |
| `operation` | string | Always. The `namespace.method` that failed. |
| `field` | string | Single-field shortcut. Prefer `fieldErrors[]`. |
| `fieldErrors` | `[{field, code, error}]` | All schema-validation failures. `code` is the stable machine code (`required`, `enum`, `min_length`, …); `error` is the human message. |
| `deviceCode` | number | Device-relayed errors only. The device's JSON-RPC code. |
| `deviceMessage` | string | Device-relayed errors only. The device's verbatim message. |
| `shellyID` | string | Device-relevant errors. |
| `requestId` | string | Always. Server-generated id; appears in logs / audit. |
| `details` | object | Free-form supplemental info that doesn't fit the keys above. |

### Categories (`data.type`)

| Category | Meaning | Typical HTTP |
| --- | --- | --- |
| `validation` | Caller's input is wrong (schema, enum, range, missing field, unknown field, unsupported op) | 400 |
| `auth` | Bearer missing or invalid | 401 |
| `permission` | Authenticated but lacks the CRUD permission | 403 |
| `not_found` | Method or resource doesn't exist | 404 |
| `conflict` | State conflict (unique key collision, etc.) | 409 |
| `rate_limit` | Per-user / per-method bucket exhausted | 429 |
| `device` | Device-side failure (offline, transient timeout) — `data.deviceCode`/`deviceMessage` carry detail | 500 / 409 |
| `unavailable` | Dependent service down (mail, telemetry channel) | 500 |
| `server` | Server-side bug or unhandled exception | 500 |

### `fieldErrors[].code` values

Stable machine codes the validator emits. Switch on these in the UI
without parsing the human-readable `error` string:

| Code | When |
| --- | --- |
| `required` | A required property is missing. |
| `type` | Value type doesn't match (`string` vs `integer`, etc.). |
| `enum` | Value isn't in the allowed list. |
| `const` | Value isn't the constant the schema requires. |
| `min` / `max` | Number out of range. |
| `min_length` / `max_length` | String length out of range. |
| `min_items` / `max_items` | Array length out of range. |
| `min_properties` / `max_properties` | Object key count out of range. |
| `max_bytes` | Object exceeds the serialized-byte limit. |
| `additional_property` | Object has an undeclared key under `additionalProperties: false`. |
| `any_of` | Value matches none of the `anyOf` alternatives. |
| `date_invalid` / `range_invalid` | Date-range parser rejected the input. |

### Standard JSON-RPC codes (transport)

| Code | Meaning | HTTP status |
| --- | --- | --- |
| `-32700` | Parse error (malformed JSON) | 400 |
| `-32600` | Invalid request (envelope shape) | 400 |
| `-32601` | Method not found | 404 |
| `-32602` | Invalid params | 400 |
| `-32000` | Unauthorized | 401 (no bearer) / 403 (bad bearer) |
| `-32001` | Server error | 500 |
| `-32800` | Timeout | 504 |
| `-32900` | Device not found / not connected | 404 |

### Domain error codes

Domain errors carry codes ≥ 1000.

| Code | Kind | When | HTTP |
| --- | --- | --- | --- |
| 1000 | `ValidationFailed` | Params failed schema or domain validation | 400 |
| 1001 | `PermissionDenied` | Caller lacks the required CRUD permission | 403 |
| 1002 | `ResourceNotFound` | Generic resource lookup miss | 404 |
| 1003 | `ResourceConflict` | Unique-key collision (e.g. duplicate name) | 409 |
| 1005 | `UnsupportedOperation` | Op not allowed in this state / phase / device class | 400 |
| 1006 | `OperationFailed` | Server-side failure while executing | 500 |
| 1007 | `ServiceUnavailable` | Dependent service down or not configured | 500 |
| 1008 | `RateLimitExceeded` | Per-user / per-method bucket exhausted | 429 |
| 1010 | `OrgScopeRequired` | Caller didn't supply the required org scope | 400 |
| 1011 | `CrossOrgReference` | Reference crosses organization boundary | 400 |
| 1100 | `EntityCapabilityUnknown` | Entity doesn't expose the requested capability | 400 |
| 1200 | `DeviceOffline` | Device is registered but currently disconnected | 409 |
| 1201 | `DeviceOperationFailed` | Device returned an error to the firmware RPC | 500 |
| 25xx / 29xx / 30xx etc. | `GroupNotFound` / `LocationNotFound` / etc. | Per-domain not-found refinements | 404 |

See the generated error registry below for the full public list.

### Concrete examples

**Validation, single field:**

```jsonc
{ "code": -32602, "message": "validation failed at name: required",
  "data": {
    "type": "validation", "operation": "Group.Create", "requestId": "rpc-l5x9k0-3",
    "fieldErrors": [{"field": "name", "code": "required", "error": "required"}]
  } }
```

**Validation, multiple fields:**

```jsonc
{ "code": -32602, "message": "validation failed at name: required",
  "data": {
    "type": "validation",
    "operation": "Notification.EmailTemplate.Create", "requestId": "rpc-l5x9k0-4",
    "fieldErrors": [
      {"field": "name",    "code": "required",   "error": "required"},
      {"field": "subject", "code": "min_length", "error": "must have at least 1 characters"}
    ]
  } }
```

**Permission denied:**

```jsonc
{ "code": 1001, "message": "Caller is not authorized for this operation",
  "data": { "type": "permission", "operation": "Device.Reboot",
            "requestId": "rpc-l5x9k0-5" } }
```

**Resource not found:**

```jsonc
{ "code": 2500, "message": "Group not found",
  "data": { "type": "not_found", "operation": "Group.Get",
            "requestId": "rpc-l5x9k0-6", "details": {"id": 99999} } }
```

**Device doesn't expose this method (e.g. `Camera.GetCapabilities` on a non-camera):**

```jsonc
{ "code": 1005, "message": "Camera.GetCapabilities not supported by this device",
  "data": {
    "type": "validation",
    "operation": "Camera.GetCapabilities", "requestId": "rpc-l5x9k0-7",
    "shellyID": "shelly2pmg4-…",
    "deviceCode": -32601,
    "deviceMessage": "No handler for Camera.GetCapabilities"
  } }
```

**Device rejected the input (id=0 not registered):**

```jsonc
{ "code": 1000, "message": "BTHome.Device.Rename: Argument 'id', value 0 not found!",
  "data": {
    "type": "validation",
    "operation": "BTHome.Device.Rename", "requestId": "rpc-l5x9k0-8",
    "shellyID": "shelly2pmg4-…",
    "deviceCode": -32602,
    "deviceMessage": "Argument 'id', value 0 not found!"
  } }
```

### Catching errors

```js
async function call(method, params) {
    const res = await fetch('https://<HOST>/rpc', {
        method: 'POST',
        headers: {Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})
    });
    const body = await res.json().catch(() => ({}));
    if (body.error) {
        const e = body.error;
        const {type, fieldErrors, requestId} = e.data ?? {};
        // Branch on `type` first — coarse category, no code lookups
        if (type === 'validation' && fieldErrors?.length) {
            for (const fe of fieldErrors) markBadInput(fe.field, fe.code, fe.error);
            return;
        }
        if (type === 'auth')        return goToLogin();
        if (type === 'permission')  return showToast('Not allowed');
        if (type === 'rate_limit')  return showToast('Too fast — slow down');
        if (type === 'device')      return showToast(`Device: ${e.data.deviceMessage}`);
        // Server / unavailable / unhandled — show requestId for support
        showToast(`${e.message} [${requestId}]`);
    }
    return body.result;
}
```

## Rate Limits

Two layers of limiting:

1. **HTTP route limiter** — a small number of convenience HTTP endpoints
   (uploads, OAuth callbacks, audit-log downloads) carry
   per-(user-or-IP) token-bucket caps. On exhaustion the server returns
   HTTP `429` with body
   `{"error": "Too Many Requests", "route": "<bucket-name>"}`. No
   `Retry-After` header today; back off and retry with jitter.
2. **Per-RPC limiter** — selected expensive methods (e.g. raw firmware
   passthroughs, broad list calls) have per-user, per-method buckets. On
   exhaustion the server returns the JSON-RPC envelope with
   `error.code = 1008` (`RateLimitExceeded`), `error.data.type = "rate_limit"`,
   and HTTP `429`.

Bucket capacities are tunable through env vars (`FM_HTTP_RATE_LIMIT_*`,
`FM_RPC_RATE_LIMIT_*`) — see [docs/tuning.md](tuning.md). Defaults are
generous enough that normal interactive use never hits them; bulk imports
and event-replay tools should batch with backoff.

## Common Patterns

### Pagination loop

```js
let offset = 0;
const limit = 500;
const all = [];
while (true) {
    const page = await call('Device.List', {limit, offset});
    all.push(...page.items);
    if (!page.has_more) break;
    offset += page.items.length;
}
```

### Retry on transient device errors

`DeviceOperationFailed` (1201) and `DeviceOffline` (1200) are usually
worth one retry after a short delay; `PermissionDenied` (1001) and
`ValidationFailed` (1000) never are.

```js
async function callRetry(method, params, tries = 3) {
    for (let i = 0; i < tries; i++) {
        try {
            return await call(method, params);
        } catch (e) {
            const kind = e?.data?.kind;
            if (i === tries - 1 || (kind !== 'DeviceOperationFailed' && kind !== 'DeviceOffline')) {
                throw e;
            }
            await new Promise(r => setTimeout(r, 500 * 2 ** i));
        }
    }
}
```

### HTTP single-call shortcut

For one-shot calls a path-style request can be more ergonomic than a JSON-RPC envelope. Both forms are equivalent and use the same auth + permissions:

```bash
# Path form
curl -X POST "https://<HOST>/rpc/Device.List" \
  -H "Authorization: Bearer <PAT>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 100}'

# Envelope form
curl -X POST "https://<HOST>/rpc" \
  -H "Authorization: Bearer <PAT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"Device.List","params":{"limit":100}}'
```

> **Errors policy for the per-method sections below.** All methods
> return errors using the canonical shape documented in
> [§Errors](#errors): top-level `{code, message, data}` with
> `data.type` (category enum), `data.operation`, and `data.requestId`
> on every error response, plus `data.fieldErrors[]` (with stable
> `code` per failure) for validation, and `data.deviceCode` /
> `data.deviceMessage` for device-relayed errors. Each method's
> `#### Errors` block — when present — lists only the **method-specific**
> codes that go beyond auth / permission / validation / not-found.
> Methods without an explicit `#### Errors` block return only those
> generic categories.
