## Rate limits

Calls are rate-limited per user and per organization, with a token bucket per
method. There are two pools: a general pool and a smaller "expensive" pool for
heavier operations.

Defaults, per minute, all configurable per deployment:
- Per user — 600 general, 30 expensive (`FM_RATE_LIMIT_GENERAL_RPM`,
  `FM_RATE_LIMIT_EXPENSIVE_RPM`).
- Per organization — 6000 general, 300 expensive
  (`FM_RATE_LIMIT_ORG_GENERAL_RPM`, `FM_RATE_LIMIT_ORG_EXPENSIVE_RPM`).

Which methods count as expensive is set per deployment
(`FM_RATE_LIMIT_EXPENSIVE_METHODS`); creating alert rules or scoped tokens and
place-search lookups are typical examples.

### When you are limited

Over the WebSocket and HTTP `/rpc` you get the domain error `RateLimitExceeded`
(code 1008, category `rate_limit`); `data.details.method` names the method, and
`data.details.scope` is `organization` when it is the org pool that tripped.
Over HTTP the same failure is HTTP 429. Plain (non-`/rpc`) HTTP routes return
HTTP 429 with `{ "error": "Too Many Requests", "route": "…" }`.

Back off and retry — exponential backoff on a 1008 or 429 is the right client
behavior.
