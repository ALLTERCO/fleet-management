## Pagination and filtering

List methods page with `limit` and `offset` — there is no cursor. A list reply
is a consistent envelope:

```json
{ "items": [], "total": 128, "limit": 25, "offset": 0, "has_more": true }
```

Page by re-issuing the call with a growing `offset` until `has_more` is false.

- `limit: 0` means unlimited — every row in one reply.
- A negative `limit` is rejected; a negative `offset` is clamped to 0.

### Example: device.List

```json
{ "id": 1, "src": "my-client", "dst": "FLEET_MANAGER",
  "method": "device.List",
  "params": { "limit": 25, "offset": 0, "filters": {}, "include": [] } }
```

- `filters` — an object of field filters applied server-side.
- `include` — extra detail sets to add to each device; the slim list is
  returned by default.
- `limit` — `0` = unlimited; the default for `device.List` is 500.

Each list method defines its own params, so check the method's entry in the
reference for the `limit`, `offset`, and `filters` it accepts — the envelope is
shared, the inputs are per-method.
