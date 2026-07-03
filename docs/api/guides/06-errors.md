## Errors

A failed call returns a JSON-RPC `error` object with three fields: a numeric
`code`, a human `message`, and an optional `data` payload.

```json
{ "id": 1, "src": "FLEET_MANAGER", "dst": "my-client",
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": { "fieldErrors": [{ "field": "limit", "error": "must be >= 0", "code": 1000 }] }
  } }
```

### Codes

Protocol-level codes are negative and follow JSON-RPC:
- `-32700` parse error, `-32600` invalid request, `-32601` method not found,
  `-32602` invalid params.
- `-32000` unauthorized (no identity), `-32001` server error, `-32800` timeout,
  `-32900` device not found.

Domain-level codes are positive integers from 1000 up, grouped by area (for
example device errors in the 1200s). Each carries a stable `category` such as
`validation`, `rate_limit`, `device`, or `not_found`.

Two you will meet early:
- Validation failure — `-32602` with `data.fieldErrors[]`, or the domain
  `ValidationFailed` (code 1000).
- Permission — `PermissionDenied` (code 1001) when you are signed in but lack
  the permission; `Unauthorized` (`-32000`) when no identity was presented.

### The `data` payload

Optional and error-specific. Fields you may see include `type` (category),
`operation`, `field`, `fieldErrors[]`, `deviceCode`, `deviceMessage`,
`shellyID`, `requestId`, and `details`.

### HTTP status

Over the HTTP `/rpc` fallback an error also carries an HTTP status: 400
validation, 403 permission, 404 not found, 409 conflict, 429 rate limit, 500
server, 504 timeout. Over the WebSocket there is no status — only the error
frame.

### Error kinds per namespace

Every namespace's `Describe` includes an `errors` array listing the domain
error kinds it can raise, each with `kind`, `code`, `message`, `httpStatus`, and
`category`. For example, `device.*` can raise `DeviceOffline` (code 1200,
category `device`).
