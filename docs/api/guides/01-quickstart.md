## Quickstart

Open an authenticated WebSocket, send a framed call, read the reply. This gets
you a device list in a few lines.

### Over the WebSocket

The access token is passed as the WebSocket subprotocol — the second argument to
`WebSocket`. See [Authentication](#authentication) for how to get a token.

```js
const ws = new WebSocket('wss://<your-host>/', token);

ws.onopen = () => {
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    src: 'my-client',
    dst: 'FLEET_MANAGER',
    method: 'device.List',
    params: { limit: 25 }
  }));
};

ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  console.log(msg.result ?? msg.error);
};
```

Every request needs `id` (a number), `src` (any string naming your client), and
`dst` (`FLEET_MANAGER` to reach the Fleet Manager). The reply echoes your `id`
back so you can match it. Frame details are in
[Transport and framing](#transport-and-framing).

### Over HTTP

For a single call without a socket, POST to `/rpc` with a bearer token:

```bash
curl -X POST https://<your-host>/rpc \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{ "method": "device.List", "params": { "limit": 25 } }'
```

The HTTP path needs no `src`/`dst`/`id` envelope and returns the bare `result`.
It cannot subscribe to events — use the WebSocket for that.

### Next

- Get a token → [Authentication](#authentication)
- Subscribe to live updates → [Events](#events)
- Handle failures → [Errors](#errors)
- Page through large lists → [Pagination and filtering](#pagination-and-filtering)
