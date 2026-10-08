<!-- audience: public -->
# Observability & Debug System

The Fleet Management application includes a built-in observability system for monitoring, debugging, and identifying performance bottlenecks in production. The system uses **tiered debug levels** to control overhead, allowing safe use even on large instances with thousands of devices.

## Container Log Viewer (Dozzle)

For Docker container-level logs, the deploy script supports an optional [Dozzle](https://dozzle.dev) integration:

```bash
DOZZLE_USERS_FILE=/absolute/path/users.yml ./deploy/deploy-public.sh up --logging
```

Dozzle provides a browser-based, real-time view of container logs on
`127.0.0.1:9999`. Simple authentication is mandatory. Generate the users file
with an explicit read-only `none` role, and expose the loopback listener through
your authenticated administrative access path if remote viewing is required.
Dozzle has no direct Docker socket mount: it reads through an internal
Docker-socket proxy that permits only the container, event, and information
APIs and rejects writes.

This complements the application-level observability system described below, which provides structured metrics, counters, and timings from inside Fleet Manager.

### Prometheus metric contract

Every defined application metric has one explicit Prometheus name. Counter
names end in `_total`. Time values use seconds, while byte values use bytes.
Internal counters may keep implementation-oriented keys and millisecond values;
the metric definition owns the public name and any unit conversion.

Browser telemetry uses the bounded `fm_application_events_total` family.
Registered internal measurements without a dedicated family use one of
`fm_internal_events_total`, `fm_internal_labeled_events_total`,
`fm_internal_values`, or `fm_internal_labeled_values`. Their registered key is
preserved in the `event` or `metric` label. For a labeled measurement, its sorted
labels are preserved as JSON in the `labels` label. Unknown internal names are
rejected and logged; an internal key is never converted into a Prometheus metric
name. The exporter contract fixture rejects duplicate, invalid, or non-canonical
public names.

### Proxy metrics and access log

Traefik exports its own Prometheus metrics on the internal port 8083
(`FM_PROXY_METRICS`, on by default) and can write a JSON access log without
headers or query strings (`FM_PROXY_ACCESS_LOG`, off by default). Use them to
tell a proxy 502 from an app error: `OriginStatus` and `OriginDuration` show
what Fleet Manager returned, `Overhead` shows time spent in the proxy. See
the [environment reference](../public/reference/env-reference.md#proxy-metrics-and-access-log-traefik).

---

## Debug Tiers

| Level | Name | Overhead | What It Shows | Production Safe? |
| ----- | ---- | -------- | ------------- | --------------- |
| 0 | OFF | Zero | Logs only | Yes |
| 1 | Light | Negligible | System vitals + module gauges | Yes |
| 2 | Medium | Low | Light + counters + RPC/DB timings | Yes |
| 3 | Full | Moderate | Medium + WS msg/s + pending RPCs + client ring buffer | Use with caution |

**Key design principle:** Each recording function checks `if (level < requiredTier) return;`, a single integer comparison, so disabled tiers have effectively zero overhead. Module stat getters only run when `/health` is polled (not on every message).

## How to Enable

### UI Toggle (Settings > Log)

Click the level button in the toolbar. It cycles: OFF → Light → Medium → Full → OFF. The button changes color to indicate the current tier:

- OFF: gray
- Light: blue
- Medium: yellow
- Full: red

### Browser Console

```javascript
window.fmObservability(2)  // Set to Medium
window.fmObservability(0)  // Turn off
```

### Environment Variable

Set `FM_OBSERVABILITY=true` in the deployment config to start with Level 2 (Medium) enabled by default.

### localStorage

```text
fm_obs_level = '0' | '1' | '2' | '3'
```

### REST API

The POST endpoints require a platform-admin bearer token. Only `GET /health`
is public.

```bash
# Set level
curl -X POST /health/observability \
  -H 'Authorization: Bearer <platform-admin-pat>' \
  -H 'Content-Type: application/json' -d '{"level": 2}'

# Legacy boolean (backward compatible)
curl -X POST /health/observability \
  -H 'Authorization: Bearer <platform-admin-pat>' \
  -H 'Content-Type: application/json' -d '{"enabled": true}'

# Reset all timings and counters
curl -X POST /health/observability/reset \
  -H 'Authorization: Bearer <platform-admin-pat>'

# Get current metrics (public)
curl /health
```

## Backend Architecture

### Observability.ts (Core Module)

Located at `backend/src/modules/Observability.ts`. Central metrics collection with three mechanisms:

1. **Module Getters** (Tier 1+): Modules register lightweight stat-getter functions that read `.size` from existing Maps, O(1), no iteration. Only called when `/health` is polled.

2. **Incremental Counters** (Tier 2+): One-line `incrementCounter('name')` calls at existing code points. Cumulative values, never iterate device lists.

3. **Timing Maps** (Tier 2+): Per-RPC-method and per-DB-method timing stats (count, avgMs, maxMs).

### Registered Modules

| Module | Stats | Source |
| ------ | ----- | ------ |
| devices | `total` (device count) | DeviceCollector.ts |
| events | `listeners`, `eventTypes`, `groupCacheSize`, `groupVersion` | EventDistributor.ts |
| statusQueue | `pending`, `queueSize`, `flushing` | ShellyMessageHandler.ts |
| audit | `queueLength` | AuditLogger.ts |
| deviceInit | `active`, `queued` | ShellyWebsocketHandler.ts |
| commander | `registered` (component count) | Commander.ts |
| waitingRoom | `pendingDevices` (number), `reconnectLimiterKeys` (number) | WaitingRoom/index.ts |
| dbPool | `total`, `idle`, `waiting` (connection pool stats) | Main PostgreSQL pool statistics boundary |
| deviceLoad | `rows`, `registered`, `gap`, `failed`, `failedIds` (saved rows vs rows in memory, last load pass) | device/deviceLoadLedger.ts |

### Tracked Counters

| Counter | Incremented In | Tier |
| ------- | -------------- | ---- |
| `devices_connected` | DeviceCollector.register() | 2 |
| `devices_disconnected` | DeviceCollector.deleteDevice() | 2 |
| `status_messages` | ShellyMessageHandler.statusSelectivePush() | 2 |
| `status_flushes` | ShellyMessageHandler flush interval | 2 |
| `audit_entries` | AuditLogger.log() | 2 |
| `audit_flushes` | AuditLogger.flushAuditLogQueue() | 2 |
| `ws_connections` | ClientWebsocketHandler on connect | 2 |
| `ws_disconnections` | ClientWebsocketHandler on close | 2 |
| `device_inits_started` | ShellyWebsocketHandler.acquireInitSlot() | 2 |
| `device_inits_completed` | ShellyWebsocketHandler.releaseInitSlot() | 2 |
| `device_inits_failed` | ShellyWebsocketHandler error catch | 2 |
| `device_gather_abandoned_total` | deviceIngress/gatheredDeviceData: a waiting-room gather was cut; `reason` label is `deadline`, `socket_closed`, `take_timeout` or `reclaimed` | 2 |
| `events_broadcast` | EventDistributor.notifyAll() | 2 |
| `rpc_success` | Commander: RPC dispatched successfully | 2 |
| `rpc_errors` | Commander: RPC dispatch error | 2 |
| `waiting_room_approved` | WaitingRoom: device accepted | 2 |
| `waiting_room_quarantined` | WaitingRoom: device quarantined (destructive) | 2 |
| `waiting_room_denied` | WaitingRoom: device rejected | 2 |
| `waiting_room_evicted` | WaitingRoom: pending device evicted; has `reason` label (`ttl` or `capacity`) | 2 |
| `waiting_room_reconnect_limited` | WaitingRoom: device blocked by reconnect limiter | 2 |
| `ws_auth_queue_drops` | ClientWebsocketHandler: messages dropped while auth queue full | 2 |
| `device_load_failures` | PostgresProvider.loadSavedDevices(): a saved row could not become a device | 2 |
| `device_load_reconcile_recovered` | device/deviceLoadReconcile.ts: rows registered by the timer that boot had missed | 2 |
| `device_event_rows_skipped_deleted_device_total` | deviceEvents/DeviceEventDrainer.ts: queued event rows not stored because their device was deleted first; the rest of the batch is stored | 2 |
| `outbox_unflushed_groups_reflushed` | delivery/OutboxWorker.ts: groups re-flushed because an alert job committed but its flush was lost | 2 |
| `outbox_unflushed_sweep_errors` | delivery/OutboxWorker.ts: the unflushed-group sweep failed | 2 |
| `audit_write_dropped` | AuditLogger.ts: audit rows lost after their retries because the Redis overflow stream also refused them | 2 |

### MCP metrics

Recorded at observability level 2 and up (`backend/src/modules/observability/mcpMetrics.ts`).
No user, organization or method labels.

| Metric | Labels |
|---|---|
| `fm_mcp_tool_calls_total` | `tool` (registered tool name, else `unknown`; past 64 names, `other`), `outcome` (`success`, `error`) |
| `fm_mcp_tool_duration_seconds` | histogram, `tool` |
| `fm_mcp_denials_total` | `reason` (stable MCP reason code) |
| `fm_mcp_rate_budget_exceeded_total` | `kind` (`read`, `write`) |
| `fm_mcp_approvals_total` | `outcome` (`asked`, `approved`, `refused`, `remembered`), `channel` (`prompt`, `token`, `standing`) |

### OpenTelemetry traces (MCP)

Off unless an OTLP collector is set: `OTEL_EXPORTER_OTLP_ENDPOINT` or
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (OTLP over HTTP), with optional
`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` (default `fleet-manager`) and
`OTEL_SDK_DISABLED=true` to force it off. Both fleet compose files pass these
through. Each MCP request is one server span named `<method> <tool>` (for
example `tools/call fm_read`) with `mcp.method.name`, `gen_ai.tool.name`,
`mcp.protocol.version`, and on failure status error with `error.type` set to
the stable reason. When the client sends a W3C `traceparent` (in `_meta` or the
HTTP header), the span joins that trace. No user, organization or argument
values are recorded (`backend/src/modules/observability/tracing.ts`).

### Saved device load gap

A saved device row that fails to build at boot is skipped, so the fleet keeps
running, but the device is then absent from every list until it is registered.
Each load pass measures membership per row and exports three gauges through
`fm_internal_values{metric="..."}`:

- `device_load_rows`: rows read from `device.list` in the last pass.
- `device_load_registered`: rows registered by the last pass.
- `device_load_gap`: rows the pass was responsible for that are not in memory.
  `0` when healthy. Alert when it is above `0`.

Every failed row is logged at `error` with its stack and kept in the
`deviceLoad` module (`failed`, `failedIds`) so the reason can be read from
`/health/full` without the log. A reconcile timer
(`FM_DEVICE_LOAD_RECONCILE_MS`, default 300000, `0` disables) reads only
`external_id`, `id` and `updated` for every physical row
(`device.fn_list_row_versions`, served by a partial covering index), fetches
the full snapshot only for rows missing from memory, and skips a failed row
until its `updated` column changes. A healthy tick reads no snapshot column.
Rows registered by the timer are counted in
`device_load_reconcile_recovered` and logged at `error` with their ids.

### Health Endpoint Response

`GET /health` (public, no auth) is the liveness probe only:

```json
{ "online": true, "version": "x.y.z" }
```

`GET /health/full` (requires admin auth, `Authorization: Bearer <admin-pat>`) returns
the rich snapshot below. Per audit CR-49 (commit `5702a20f`), this split keeps
internal metrics + build commit + authz state from leaking to unauthenticated
callers on OSS / public deployments.

The `metrics` block scales with the current observability level:

```json
{
  "online": true,
  "version": "x.y.z",
  "metrics": {
    "level": 2,
    "uptimeS": 3600,
    "eventLoopLagMs": 2,
    "memory": { "rssM": 150, "heapUsedM": 80, "heapTotalM": 128, "heapTrend": "stable" },
    "wsClients": 5,
    "modules": {
      "devices": { "total": 500 },
      "events": { "listeners": 45, "eventTypes": 8, "groupCacheSize": 450 },
      "statusQueue": { "pending": 0, "queueSize": 15, "flushing": false },
      "deviceInit": { "active": 2, "queued": 0 },
      "audit": { "queueLength": 3 },
      "commander": { "registered": 28 },
      "dbPool": { "total": 10, "idle": 8, "waiting": 0 },
      "deviceLoad": { "rows": 142, "registered": 141, "gap": 1, "failed": 1, "failedIds": "shellypro2pm-aabbcc" }
    },
    "counters": { "devices_connected": 512, "rpc_success": 890 },
    "rpcTimings": { "Device.List": { "count": 42, "avgMs": 12, "maxMs": 45 } },
    "dbTimings": { "fn_fetch_devices": { "count": 100, "avgMs": 3, "maxMs": 15 } },
    "rpcErrors": [
      { "method": "Device.GetConfig", "error": "timeout after 10000ms", "ts": 1700000000000 }
    ],
    "initFailures": [
      { "shellyID": "shellyplus1-AABBCC", "error": "connection refused", "ts": 1700000000000 }
    ]
  }
}
```

Tier gating:

- **Level 0**: `metrics` is `null`
- **Level 1**: `level`, `uptimeS`, `eventLoopLagMs`, `memory` (with `heapTrend`), `wsClients`, `modules`
- **Level 2+**: Level 1 + `counters`, `rpcTimings`, `dbTimings`, `rpcErrors`, `initFailures`

`degraded: true` is added at the top level, at every tier, when
`device_load_gap` is above `0`. The response stays `200`: the service is up,
but some saved devices are not in memory.

## Frontend Architecture

### observability.ts (Frontend Core)

Located at `frontend/src/tools/observability.ts`. Mirrors the backend tier system:

- **RPC Timing Ring Buffer** (Tier 2+): Records the last 200 RPC calls with method, duration, and timestamp.
- **Counter Rate-of-Change Tracking** (Tier 2+): Computes per-minute rate of change for each counter between poll intervals.
- **WS Message Rate** (Tier 3): Counts WebSocket messages per second via a 1-second interval.
- **Pending RPC Count** (Tier 3): Tracks how many RPCs are awaiting responses.
- **Backend Metrics Cache**: Polls `/health` and caches the response for UI display.
- **Debug Report Export**: Fetches `/health/debug-report` from the backend and combines it with frontend state for a comprehensive JSON dump.

### Log Page (Settings > Log)

The log page adapts its UI based on the current debug tier:

**Always visible:**

- Log output with level-based filtering (ALL, ERROR, WARN, INFO, DEBUG)
- Log level border colors (red = ERROR/FATAL, yellow = WARN, subtle gray = DEBUG)
- Log pinning (hover to reveal pin button, pinned logs appear at top)
- Text search across log messages (Ctrl+K / Cmd+K to focus)
- Copy, Download, Export Report, Clear buttons
- Auto-scroll toggle
- Keyboard shortcuts (Ctrl+K search, Ctrl+L clear, Escape dismiss)

**Tier 1 (Light) adds:**

- System vitals bar (uptime, event loop lag, memory with heap trend indicator, WS clients)
- Collapsible module performance grid with color-coded stat cards

**Tier 2 (Medium) adds:**

- Grouped counter display with rate-of-change (+N/min) indicators
- Sortable RPC timings table (click headers to sort)
- Sortable DB timings table
- RPC Errors panel (last 50 errors with timestamp, method, and error message)
- Init Failures panel (last 50 device init failures with shellyID and error)
- Reset Timings button

**Tier 3 (Full) adds:**

- Frontend metrics panel (WS msg/s, pending RPCs, client-side RPC ring buffer)
- Faster polling (2s instead of 5s)

### Module Card Colors

Module stat cards are color-coded to highlight bottlenecks:

- **Green** (default): Normal operation
- **Yellow**: Warning thresholds exceeded (e.g., >1000 devices, >50 active inits)
- **Red**: Critical thresholds exceeded (e.g., >5000 devices, >100 active inits, stuck flush)

### Device GUI Diagnostics

When OBS level >= 2, the Device Web GUI modal shows a collapsible section with device-specific RPC timings filtered from the ring buffer by shellyID.

The server also emits structured `device-gui` logs for the complete proxy path.
Each line carries a bounded stage and outcome plus the available logical device
ID, Shelly ID, target IP, short session trace, HTTP method, path, status, and
duration. Query strings, cookies, tokens, and payloads are not logged.

Follow one GUI attempt by filtering for `"event":"device_gui"` and its
eight-character `trace`. The normal sequence is:

1. `launch/requested`
2. `attestation/identity_matched`
3. `session/success`
4. `launch/success`
5. `http/success`
6. `websocket/success`
7. `websocket/closed` or `websocket/revoked`

The HTTP and WebSocket proxy responses include `X-FM-Device-GUI-Trace`.
HTTP responses also include `Server-Timing: device-gui;dur=...` for browser
network inspection.

| Metric | Meaning |
| --- | --- |
| `fm_device_gui_events_total{stage,outcome}` | Launch, identity, session, HTTP, and WebSocket results |
| `fm_device_gui_bytes_total{transport,direction}` | HTTP and WebSocket bytes in both directions |
| `fm_device_gui_duration_seconds_total{stage,outcome}` | Total operation time in seconds by stage and outcome |
| `fm_device_gui_duration_samples_total{stage,outcome}` | Operation samples used to calculate average time |
| `fm_device_gui_http_responses_total{status}` | Proxied HTTP responses by status class |
| `fm_device_gui_websocket_compression_total{offered,negotiated}` | Device GUI per-message deflate negotiation |
| `fm_device_gui_active_websockets` | Current Device GUI WebSocket count |

Common VPC failures are reported as `timeout`, `connection_refused`,
`connection_reset`, `unreachable`, `identity_mismatch`, or `device_changed`.
This distinguishes a missing route or firewall timeout from a reachable host
that is not the expected Shelly device.

### WebSocket Traffic Diagnostics

The shared browser and Shelly WebSocket servers track traffic without recording
message payloads.

| Metric | Meaning |
| --- | --- |
| `fm_ws_connection_events_total{traffic,outcome,compression}` | Open, close, and error events for client and device sockets |
| `fm_ws_compression_total{traffic,offered,negotiated}` | Connections with and without per-message deflate |
| `fm_ws_message_bytes_total{traffic,direction,format,negotiated}` | Decoded inbound text and binary message bytes |
| `fm_ws_message_size_bucket_total{traffic,direction,format,size,negotiated}` | Message counts split into bounded size buckets |
| `fm_ws_wire_bytes_total{traffic,direction,negotiated}` | TCP wire bytes on connections with or without negotiated compression |
| `fm_ws_closes_total{traffic,negotiated,code}` | Bounded close codes for connections with or without negotiated compression |
| `fm_ws_active_connections{traffic}` | Current client and device WebSocket count |

Connection-close debug lines include the traffic class, compression state,
close code, lifetime, and TCP bytes sent and received. Payload inspection is
intentionally excluded because device frames can contain credentials, commands,
and private sensor data.

Wire-byte counters are updated on the heartbeat interval and once more at close,
so long-lived device sockets remain visible in rate queries. Debug connection
logs include the remote IP for network diagnosis; apply the normal diagnostic
log retention and access policy to this data.

### Log Level Border Colors

Each log entry displays a subtle left border color based on its severity level:

- **Red** (`border-red-600`): ERROR and FATAL level logs
- **Yellow** (`border-yellow-600`): WARN level logs
- **Gray** (`border-neutral-700`): DEBUG level logs
- **Transparent**: INFO and other levels (no visible border)

This provides an at-a-glance visual scan of log severity without reading each entry.

### Log Pinning

Important log entries can be pinned for quick reference. Hover over any log entry to reveal a diamond-shaped pin button on the left side. Clicking it toggles the pin state:

- **Filled diamond**: Log is pinned
- **Empty diamond**: Log is not pinned

Pinned logs appear in a dedicated "Pinned" section at the top of the log area, above the scrolling log output. The pinned section shows the count of pinned logs and a "Clear pins" button to unpin all at once. Pins use the log's timestamp (`ts`) as identifier and are stored in the Pinia console store.

### Keyboard Shortcuts

The log page supports the following keyboard shortcuts:

| Shortcut | Action |
| -------- | ------ |
| `Ctrl+K` / `Cmd+K` | Focus the search input |
| `Ctrl+L` / `Cmd+L` | Clear all logs |
| `Escape` | Clear search query and blur search input |

Shortcuts are registered on mount and cleaned up on unmount to avoid leaks.

### Memory Trend Indicator

The System Vitals Bar (Tier 1+) displays a heap trend arrow next to the heap usage:

- **Red up arrow**: Heap is growing (potential memory leak)
- **Green down arrow**: Heap is shrinking (GC is reclaiming memory)
- **Gray right arrow**: Heap is stable

The `heapTrend` field is computed by the backend by comparing heap snapshots over time and is included in the `memory` object of the `/health` response.

### Grouped Counters

At Tier 2+, counters are grouped by their prefix (the part before the first underscore). For example, `devices_connected` and `devices_disconnected` appear under a "devices" group header, while `audit_entries` and `audit_flushes` appear under "audit". This makes it easier to find related counters in large deployments with many counter types.

### Rate-of-Change Display

Each counter in the grouped counter panel shows a rate-of-change indicator in the format `(+N/min)` or `(-N/min)`. The rate is computed on the frontend by comparing counter values between consecutive `/health` poll responses and normalizing to a per-minute rate. A positive rate indicates the counter is actively incrementing; zero-rate counters show no indicator.

### RPC Error Ring Buffer

At Tier 2+, the backend maintains a ring buffer of the last 50 RPC errors. Each entry contains:

- `ts`: Timestamp of the error
- `method`: The RPC method that failed
- `error`: The error message

These are displayed in a collapsible "RPC Errors" panel in the log page, sorted by time with the most recent first. This helps identify recurring RPC failures without having to search through log output.

### Device Init Failure Log

At Tier 2+, the backend maintains a ring buffer of the last 50 device initialization failures. Each entry contains:

- `ts`: Timestamp of the failure
- `shellyID`: The Shelly device ID that failed to initialize
- `error`: The error message

These are displayed in a collapsible "Init Failures" panel. This is particularly useful for diagnosing devices that repeatedly fail to connect or initialize.

### Export Debug Report

The "Export Report" button in the toolbar generates a comprehensive JSON debug dump that combines:

- **Backend debug report**: Fetched from `/health/debug-report`, includes server-side metrics, configuration, and state
- **Frontend metrics**: Current RPC timings ring buffer, WS message rate, pending RPC count, and current OBS level
- **Filtered logs**: All currently displayed logs as text (respecting active filters and search)
- **Browser info**: User agent, current URL, and ISO timestamp

The report is downloaded as `debug-report-<timestamp>.json`. This is useful for filing bug reports or sharing diagnostic information with support.

### DB Connection Pool Stats

The `dbPool` module reads an immutable statistics snapshot from the shared
PostgreSQL pool and reports only:

- `total`: Total number of connections in the pool
- `idle`: Number of idle (available) connections
- `waiting`: Number of queued requests waiting for a connection

The Prometheus names are `fm_db_pool_total`, `fm_db_pool_idle`, and
`fm_db_pool_waiting`. Fleet does not expose the pool, clients, credentials, or
query methods through observability.

Stored procedures and plain SQL (`queryRows`, SQL transactions, exports) use
this one pool, so `fm_db_pool_*` covers all of them. There is no separate
query pool and no `fm_db_query_pool_*` series any more. The outbox pool for
graphile-worker reports as `fm_db_outbox_pool_*`. The shared pool also
exports, read at scrape time:

| Metric suffix | Meaning |
|---|---|
| `_waiting_foreground`, `_waiting_background` | Checkouts waiting, in the priority gate or in pg-pool's queue, by priority |
| `_checked_out_foreground`, `_checked_out_background` | Connections handed over and not yet back, by the priority of the call that holds them |

`_idle` has no priority: an idle connection belongs to nobody. `_total` minus
`_idle` is higher than the two `_checked_out_` gauges together while new
connections are still opening.

These stats appear automatically in the Modules grid at Tier 1+. A short
waiting spike during device admission is different from sustained waiting
during settled traffic. Review `FM_DB_CONNECTIONS` only when repeated samples show
waiting together with no idle connections and slower database-backed requests.
See [tuning.md](../public/reference/tuning.md) for the pool-sizing rule.

### Database call phases

`fm_db_duration_seconds_total` is one number per call: from the call until the
caller resumes. It hides whether the time went to waiting for a connection, to
PostgreSQL, or to a busy event loop. With `FM_DB_TIMING_DETAIL=true` and level
2 or higher, every call is also split into phases. Off by default; the cost is
in [tuning.md](../public/reference/tuning.md#fm_db_timing_detail).

| Metric | Labels |
|---|---|
| `fm_db_call_phase_seconds` | histogram; `method`, `priority` (`foreground`, `background`), `path` (`procedure`, `sql`), `phase` |
| `fm_db_calls_in_flight` | gauge; `method`, `priority`, `path`: calls started and not finished |

`path` names the call path, not a pool: `procedure` is a stored procedure,
`sql` is plain SQL (queryRows and SQL transactions). Runs recorded before the
rename used `pool` with `main` and `query`.
Both paths wait at the same gate for the same connections.

A wait ends at the handover: the moment the gate gives the permit, pg-pool
gives the connection, or pg reads the reply. That moment is recorded in the
same tick, before any other queued work runs. The waiting code runs again later,
when the event loop gets to it. That gap is `resume_delay`, so a busy Fleet
does not show up as a lack of connections.

Phases, in order:

| `phase` | Starts at | Ends at |
|---|---|---|
| `gate_wait` | call start | the priority gate (`FM_DB_FOREGROUND_RESERVE`) gives the permit, or times out |
| `checkout_wait` | the call resumes with the permit | pg-pool hands over a connection (includes opening a new one) |
| `query` | the call resumes with the connection and sends the statement (inside a transaction: statement start) | pg reads the reply and calls back |
| `resume_delay` | each handover above | the waiting code runs again; the gaps after the gate, the checkout and the reply, added up |
| `result_handling` | the first reaction to the reply | the caller's code runs again |
| `hold` | pg-pool hands over the connection | the connection is back in the pool |

Except `hold`, the phases do not overlap and leave no gap. For a single call,
`gate_wait + checkout_wait + query + resume_delay + result_handling` is the
whole call. That is about the span `fm_db_duration_seconds_total` times for a
stored procedure, and for `postgres.queryRows` for a raw query; the older
metric also counts the few microseconds before the timing starts. `hold`
overlaps the others: for a single call it covers `query` and part of
`resume_delay`; for a transaction it covers every statement in it. Never add
`hold` to the rest.

Limits:

- pg reads a reply only when the loop polls the socket. If the loop is busy
  while PostgreSQL answers, that wait is inside `query`. Compare `query` with
  `pg_stat_statements` and the loop window for that part.
- `resume_delay` covers only the gaps after a handover. On failure (gate
  timeout, failed connect) only the waits are recorded.

`method` values:

- A stored procedure keeps the name used by `fm_db_*`, for example
  `device.fn_fetch`.
- A `queryRows` call is `sql:<file>.<function>` of the code that called it, or
  `sql:<file>:<line>` for an unnamed function. The name comes from the call
  stack, not from the SQL text. Lines are lines of the running JavaScript.
- A transaction is `tx:<file>.<function>` of the code that opened it. It has
  `gate_wait`, `checkout_wait`, `resume_delay` (after the gate and the
  checkout) and `hold`; its statements are timed under their own `method`
  with `query`, `resume_delay` (after the reply) and `result_handling` only.
- After 200 methods (`FM_OBS_LABELED_SERIES_PER_NAME_MAX`), new ones count as
  `other` and one warning is logged.

Failed calls are timed too. A gate timeout has only `gate_wait`; a failed
connect has `gate_wait` and `checkout_wait`. Not timed: `withPooledClient`
(export streams), the `BEGIN`/`COMMIT` statements themselves (they are inside
`hold`), the outbox worker pool, and the startup procedure catalog read.

How to read it:

- `gate_wait` high, `checkout_wait` low: too many calls for the permits. Cut
  calls or raise permits. Check `_checked_out_` at the same time: permits
  in use with connections idle point at the gate, not the pool size.
- `checkout_wait` high: new connections are slow, or the idle timeout closes
  them between bursts.
- `resume_delay` high: Fleet itself is busy. The permit, connection or reply
  was ready and the code waited for its turn on the event loop. More
  connections do not help; less work per tick does.
- `query` well above `pg_stat_statements` mean time while the loop window is
  busy: the reply waited in the socket for the loop to poll it (see Limits).
- `hold` far above `query` for a transaction: application work between its
  statements.

### Pool gate occupancy and connection churn

A gauge read every 10 s misses short spikes. These series are sums or window
peaks kept inside Fleet, so a scrape at any interval loses nothing.

- `fm_db_gate_in_use_seconds_total{pool,in_use}`: seconds the shared-pool gate
  spent with that many permits in use. The rate per `in_use` value is the share
  of time at each level; `in_use` = pool size minus the reserve is "full for
  background".
- `fm_db_gate_wait_with_room_seconds_total{pool,priority}`: seconds a priority
  had a waiter while a connection it may use was free. Background should stay
  at 0. Foreground grows when background is due and users wait for a release.
- `fm_db_gate_workload_held_seconds_total{pool,workload,share}`: connection
  seconds one labelled kind of work (`alert`, `energy`, `em-sync`, `rollup`)
  held. The rate is the average number of connections it held. `share` is
  `guaranteed` (within its cap) or `borrowed` (above its cap, on idle
  connections). Unlabelled work, user requests included, is not listed.
- `fm_db_gate_workload_grants_total{pool,workload,share}`: connections the gate
  granted to that kind, split the same way.
- `fm_db_pool_connections_opened_total{pool}` and
  `fm_db_pool_connections_closed_total{pool}`: connection churn for `shared`
  and `outbox`. pg-pool closes a connection after 10 s idle.
- `fm_db_calls_holding_peak{method,priority,path}`: the most connections that
  method held at once in the last complete 10 s window (wall-clock aligned).
  Needs `FM_DB_TIMING_DETAIL`.

Each kind's cap is its guaranteed share. Em-sync may also borrow: past its
cap it takes a connection only when no user request and no other work within
its own share is waiting, never from the foreground reserve, and at most every
background connection but one (pool size minus reserve minus 1; 4 on a
6-connection pool with a reserve of 1). While other work waits, em-sync gets
no new connection until it is back under its cap, so borrowed connections go
back to users as em-sync calls finish. Running queries are never stopped. This
is the work-conserving model of cgroup v2 weights and Kubernetes requests:
spare capacity is lent, a busy neighbour takes it back. Other kinds stay at
their cap. A rising `share="borrowed"` rate with flat
`fm_db_gate_wait_with_room_seconds_total{priority="foreground"}` means the
lending is free; if foreground waits grow with it, look at statement time.

PostgreSQL sees the pools as `application_name` `fleet-shared` and
`fleet-outbox`, so `pg_stat_activity` samples split by pool.

### Alert fire batches

Alert fires are written by one writer per process. Fires that arrive within one
tick (`FM_ALERT_FIRE_BATCH_TICK_MS`) commit in one transaction, up to
`FM_ALERT_FIRE_BATCH_MAX_ROWS`.

| Metric | Type | Meaning |
|---|---|---|
| `fm_alert_fire_batch_rows` | histogram | Fires in one batch transaction attempt (split retries included) |
| `fm_alert_fire_batch_flush_seconds` | histogram | Time one batch transaction took, connection wait included |
| `fm_alert_fire_batch_flushes_total{outcome}` | counter | Batch transactions, `committed` or `failed` |
| `fm_alert_fire_batch_split_retries_total` | counter | Failed batches retried as two halves |
| `fm_alert_fire_queue_wait_seconds` | histogram | Time a fire waited in the queue before its batch started |
| `fm_alert_fire_queue_depth` | gauge | Fires waiting now |
| `fm_alert_fire_flushes_in_flight` | gauge | Batch transactions running now (at most 2) |

How to read it:

- Commits per second: `rate(fm_alert_fire_batch_flushes_total{outcome="committed"}[1m])`.
  Fires per attempt: `rate(fm_alert_fire_batch_rows_sum[1m])` divided by
  `rate(fm_alert_fire_batch_rows_count[1m])`.
- `fm_alert_fire_queue_wait_seconds` near the tick is normal. Well above it
  means batches wait for a connection or for the batch before them.
- `fm_alert_fire_batch_flush_seconds` p99 above the tick means batches take
  longer than they collect; see the revisit triggers in the decision.
- Split retries should be rare. Each one is a failed batch: a fire the
  database refused, or a deadlock between the two batches that may run at once.
  The fire that fails alone still counts in `alert_fire_failed{stage}`.
- The batch transaction is timed as `tx:AlertEngine.writeFireBatch` in the
  database call phases above.

### Event loop window

At level 1 and up, each `/metrics` scrape reads the loop utilization since the
previous scrape and starts a new window. With `FM_DB_TIMING_DETAIL=true` it
also reads a 1 ms resolution delay histogram and resets it. Use one scraper;
a second one splits the windows. Node drops the first delay sample after a
reset, so the delay of the scrape's own tick is not in the next window;
utilization still counts it.

| Metric | Type | Meaning |
|---|---|---|
| `fm_event_loop_window_seconds` | gauge | Window length |
| `fm_event_loop_window_utilization` | gauge | Share of the window the loop was busy (0-1) |
| `fm_event_loop_active_seconds_total` | counter | Busy time since start; `rate()` gives utilization for any range |
| `fm_event_loop_idle_seconds_total` | counter | Idle time since start |
| `fm_event_loop_window_delay_seconds{percentile}` | gauge | `0.5`, `0.99`, `1.0` (max) delay in the window; detail only |
| `fm_event_loop_delay_samples_total` | counter | Delay samples counted at each scrape; detail only |
| `fm_event_loop_delay_sample_seconds_total` | counter | Sum of those samples; detail only |

The older `fm_event_loop_delay_seconds` stays as it was: 20 ms resolution,
never reset, so its percentiles describe the whole process life.

In-flight work per subsystem (alert engine, journal, persist, energy, BLU,
status, sensor) is not a separate metric. It would need a tag where each
subsystem starts its work, including the device status and persist paths.
Group `fm_db_calls_in_flight` by `method` instead: procedure schema names and
`sql:<file>` labels map to subsystems.

### Sweep alert read batches

Successful per-device sweep evaluations check for old evaluation-error alerts
through a tenant/rule-local batch reader. Online devices also use this reader
to check for old offline alerts; each offline alert is cleared before that
device's evaluation-error cleanup. It groups only already-requested
fingerprints after asynchronous preparation finishes within the existing
bounded sweep batch, then dispatches up to 32 unique fingerprints per statement.
Identical keys share a read only while that read is still queued. Requests made
after submission get fresh statements; completed batch results are not cached.
Alert transitions retain the configured sweep concurrency. Checks that must
clear an alert before firing another remain in their original evaluation order.
The reader also supports next-microtask dispatch for immediate callers. No new
timer or worker queue is added.

At Tier 2+, the existing `fm_internal_events_total{event="..."}` family exports:

- `alert_read_batch_queries`: statements submitted by the sweep batch reader.
  A single ready fingerprint uses the canonical scalar lookup; two or more use
  the batch lookup. SQL method counters distinguish these calls.
- `alert_read_batch_fingerprints`: fingerprints submitted in those statements.
- `alert_read_batch_errors`: failed or invalidated batches.
- `alert_read_batch_queue_wait_seconds_total`: summed wait before submission,
  across all requested fingerprints.
- `alert_read_batch_read_seconds_total`: summed statement-call duration,
  including waiting in the existing database pool.

Use counter differences over the same interval. Fingerprints divided by queries
gives average batch size. Queue-wait seconds divided by fingerprints gives
average added wait; read seconds divided by queries gives average read duration.

The `fm_internal_values{metric="..."}` family exports
`alert_read_batch_queued`, `alert_read_batch_oldest_queued_seconds`,
`alert_read_batch_last_size`, `alert_read_batch_last_queue_wait_seconds` and
`alert_read_batch_last_read_seconds`. Queue gauges update when requests are
queued, submitted or cancelled. The last-value gauges describe one batch, not
an interval maximum. A periodic scrape may miss a short queue.

Compare these signals with shared and outbox pool waiting, sweep completion
duration, rule evaluation wait and completed-device counters. A smaller pool
queue alone is not proof of less work or faster completion. Batch failures
reject all waiting callers; rule invalidation and shutdown reject outstanding
reads. The existing sweep deadline still allows started evaluations to finish.

### Sweep pacing

The scheduled sweep spreads each tick's batches over a window of
min(`FM_ALERT_SWEEP_INTERVAL_SEC`, `FM_ALERT_SWEEP_MAX_DURATION_MS`) / 2,
12.5 s by default, paced to the size of the previous tick. The first tick
after start runs unpaced. `fm_internal_values{metric="..."}` describes the
last tick: `alert_sweep_duration_seconds`, `alert_sweep_db_calls` (calls
through the main and query pools, not the job queue),
`alert_sweep_rows_read` (presence, BLU and snapshot rows),
`alert_sweep_units` (paced work units) and `alert_sweep_pace_wait_seconds`.
`alert_sweep_org_failures` counts orgs whose sweep failed while the others ran.

`alert_fire_failed{stage="prepare|write|route|record"}` counts fires whose alert
transaction failed and rolled back, on both the event path and the sweep.
Stage is the step that threw: the reads before the transaction, the alert and inbox write, the delivery routing,
or the notice-time record. The error is logged at error level by the caller.
A rise means alerts are not being stored or sent; alert on any sustained
increase.

### EM rollup work and backlog health

Raw retention is configured through `device_em.fn_configure_stats_retention`.
The effective interval lives in `device_em.stats_retention`; the scheduled
`job_retain_stats` reads that row and has no duplicate interval in its job
configuration. The installer passes `EM_STATS_RETENTION` to the same function.
The database runtime panel reads that effective interval.

Migration 20055 preserves the existing guarded job's interval. It removes the
ordinary raw retention policy that could bypass pending work. Configuration
reapplication keeps one guarded job and preserves its schedule and enabled state.
Cleanup protects the earliest pending data time and waits for active raw writes
and both projection writers. It records actual removed chunk ranges in
`device_em.stats_expiry` in the same transaction. Rollback preserves that evidence.
This coordination alone does not establish complete input for a later replay.

Migration 20057 keeps unsafe historical replacements in the existing
`rollup_dirty` queue with `blocked_at` and `blocked_reason`. The ready indexes
exclude held keys; new input reactivates its key through the existing marker
update. Scoped report-pending checks still include held work; the oldest
queue age counts due keys only (see below). Strict reports cannot treat held
work as complete.

`energy_15min.source_kind` records the selected source and `source_expiry_id`
records the last overlapping raw expiry seen by the calculation. Existing
rows keep unknown provenance. After expiry, a source change, or unknown saved
history, replacement requires consistent synced intervals covering the whole
bucket. An empty read never deletes a saved total. Gaps, unknown intervals and
conflicts preserve the old result and remain pending. Ordinary initial partial
projections retain their existing behavior; provenance is not a completeness
flag. The worker, direct writer and missing-history backfill share the same
calculation and replacement checks.

`fm_em_rollup_blocked_total` counts attempts that held a key. It is not the
current held queue size. Inspect the database reasons and the held gauges;
held work needs source recovery and may keep raw retention from advancing.
Do not clear markers or move sync progress forward to hide it.

`fm_em_rollup_last_success_timestamp_seconds` records a valid worker result,
including an empty queue. `fm_em_rollup_last_progress_timestamp_seconds` changes
only when a batch completes work. Compare both with backlog count and oldest
age; a recent empty poll does not prove that pending work completed.
The existing backlog count is PostgreSQL's live-row estimate. Its zero value
does not prove the queue is empty. Oldest age reads the actual oldest due marker;
acceptance tests separately count committed queue rows exactly.

The worker rejects missing, invalid, negative or fractional completion counts.
Backlog reads must return a valid count and age together. A failed read keeps
the previous values and sets `fm_em_rollup_health_valid` to zero. Use
`fm_em_rollup_health_last_success_timestamp_seconds` to detect stale readings.
Do not interpret a failed health read as an empty queue.

At Tier 2+, `fm_em_rollup_failures_total` counts failed work attempts and
`fm_em_rollup_health_failures_total` counts failed or invalid backlog reads.
A health read failure does not turn a committed batch into a failed batch.
The designated observer still checks backlog after a failed work attempt,
at the existing health interval, using the existing database pool.

Repeated work failures use exponential delay with jitter, starting at
`FM_EM_ROLLUP_POLL_MS` and capped by `FM_EM_ROLLUP_IDLE_POLL_MAX_MS`.
A successful work call resets that delay. Successful nonempty batches continue
without a sleep. Shutdown cancels an idle or retry sleep and waits for any
database call already running to finish.

#### Due, scheduled, held and abandoned rollup work

An EM meter's 15-minute bucket is computed once, when it closes. A record write
queues its open bucket as scheduled: not due until the bucket ends plus
`FM_EM_ROLLUP_CLOSE_GRACE_MS`, or earlier when the channel's sync bookmark
passes the bucket end. A late record makes its key due after
`FM_EM_ROLLUP_LATE_DEBOUNCE_MS`. Live (PM, BLU) keys are due at once. Readers
add the records of buckets not yet computed, so scheduled work is normal
waiting, not lag.

`fm_em_rollup_dirty_buckets` is the table estimate of every queued key:
scheduled, due, held and abandoned. `fm_em_rollup_oldest_dirty_age_seconds` is
the age, since first marked, of the oldest due key (not held, due time
reached). Scheduled and held keys do not count in it; they have their own
gauges below. An EM key becomes due when its bucket closes, so its age then
already includes the bucket's 15 minutes. Both stay for existing dashboards.
The same health read (`device_em.fn_rollup_backlog_stats`) also reports the
work split by state:

| Metric | Meaning |
| --- | --- |
| `fm_em_rollup_ready_buckets` | Due keys the worker can compute now. Table estimate less the exact held, abandoned and scheduled counts, so it stays cheap during catch-up |
| `fm_em_rollup_ready_oldest_age_seconds` | Seconds the oldest due key has waited since it became due. For a live key that is since it was first marked; for an EM record key, since its bucket closed or its late debounce ended. This is the worker lag |
| `fm_em_rollup_scheduled_buckets` | Keys not due yet: open EM buckets waiting for their close, and late keys inside their debounce |
| `fm_em_rollup_held_buckets{reason}` | Held keys inside the correction window, by `missing_input`, `conflicting_input` or `incomplete_history` |
| `fm_em_rollup_held_oldest_bucket_age_seconds{reason}` | Age of the oldest held bucket time, by reason |
| `fm_em_rollup_abandoned_buckets{reason}` | Keys set aside after the correction window with their raw rows copied, by reason |

Each known reason is exported every read, with 0 when it has no keys.

`fm_em_rollup_completed_keys_total{source_kind}` counts keys the worker
computed and saved, by the source the saved bucket came from: `em_sync` (the
meter's own 1-minute records) or `live`. With close-once an `em_sync` key is
normally computed once per bucket, plus once per late correction. A rate above
one per EM key per 15 minutes shows recomputes beyond the one at close.

The counter has no device-type label: the rollup queue key holds only device,
channel, tag, domain and phase, so the component kind and the model are not in
the claim result.

Alert on `fm_em_rollup_ready_oldest_age_seconds` well below the raw retention
interval, and on `fm_em_rollup_held_buckets` above zero for longer than a day.
A rising `fm_em_rollup_abandoned_buckets` means buckets went past
`FM_EM_HELD_CORRECTION_DAYS` without a fix.

A held key older than `FM_EM_HELD_CORRECTION_DAYS` (default 7) is abandoned by
the raw retention job: its raw rows are copied to
`device_em.rollup_held_evidence`, the key is recorded in
`device_em.rollup_abandoned`, and `rollup_dirty.abandoned_at` is set. Abandoned
keys no longer hold back raw retention. New input for the key clears the mark
and the key is computed again. The job abandons in steps of 1,000 keys, each
committed before the raw table lock is taken.

Retention takes its raw table lock with a 2 s `lock_timeout`, up to 6 times,
5 s apart, so a long writer can no longer queue every raw insert behind it.
When every attempt times out the run fails with `STATS_RETENTION_LOCK_BUSY`
(SQLSTATE 55P03) and the job retries on its next run.

Strict reports (`require_complete_data`) wait only for ready work in their
period. Held or abandoned work in the period fails at once with domain error
1402 (`EnergyHistoryIncomplete`); `data.details` lists held and abandoned keys
by reason.

The em-sync drainer and the rollup worker run under their own shared-pool
caps, `FM_DB_EMSYNC_MAX_CONNECTIONS` and `FM_DB_ROLLUP_MAX_CONNECTIONS`
(default 1 each), like live energy saves. Em-sync may borrow idle connections
above its cap (see Pool gate occupancy). See the tuning reference.

### EM History Sync Diagnostics

These metrics separate exact cursor lag from the configured tolerance used to
decide whether a channel is caught up. They do not change the existing raw lag
metrics.

| Metric                                       | Meaning                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `fm_em_sync_caught_up_slack_seconds`         | Configured lag threshold at or below which an EM channel is considered caught up         |
| `fm_em_sync_channels_beyond_caught_up_slack` | Tracked EM device channels whose raw cursor lag is greater than the configured threshold |

Push delay and the push buffer. Pushed records wait in the Redis push buffer;
pulled history pages go to PostgreSQL directly:

| Metric | Meaning |
| --- | --- |
| `fm_em_sync_push_delay_seconds{model}` | Histogram of the time from the end of a pushed EM record to its receipt. `model` is the device's own app code (for example `Pro3EM400`, `MiniEMG4`), stripped to letters, digits, `.`, `_` and `-` and cut at 32 characters; `unknown` when the device reports none. Only meters with `emdata` or `em1data` components push, so the series count is the number of EM product codes in the fleet |
| `fm_em_sync_buffer_depth` | Entries in the EM push buffer (Redis stream), read each sync tick. One entry is one pushed record. This is the stream length, not the pending count |
| `fm_em_sync_buffer_bytes` | Bytes the push buffer counts: its entries plus the key lists they refer to. Counted in the same Redis script that adds or deletes entries, so it is exact. Redis memory is about 1.3x this |
| `fm_em_sync_buffer_max_bytes` | Configured byte budget (`FM_EMSYNC_STREAM_MAX_BYTES`). A push that would pass it is refused whole |
| `fm_em_sync_catchup_high_water_percent` | Percent of the byte budget at which history pulls pause |
| `fm_em_sync_pull_pause_age_seconds` | Oldest-entry age at which history pulls pause (`FM_EMSYNC_PULL_PAUSE_AGE_MS`) |
| `fm_em_sync_buffer_capacity_rejected_total` | Pushes the buffer refused (byte budget or entry cap). The next pull of that meter fills the minutes |
| `fm_em_sync_pull_paused{reason}` | 1 while catch-up pulls are held by the push buffer. `reason` is `bytes` (at the high-water mark) or `age` (oldest entry too old) |
| `fm_em_sync_pull_pauses_total{reason}` | Pull passes that stopped before their next page: `pool` (database pool busy), `bytes` or `age` (push buffer) |
| `fm_em_sync_pull_rows_written_total` | Raw rows history pulls wrote to PostgreSQL directly. Pulls never enter the push buffer |
| `fm_em_sync_pull_write_failures_total` | Pulled pages not stored. The pass stops and the page is pulled again later |
| `fm_stream_length{stream="em-sync-buffer"}` | Same stream length, read by the stream health probe |
| `fm_stream_pending_entries{stream="em-sync-buffer"}` | Entries the drainer has read but not yet acknowledged |
| `fm_stream_oldest_age_seconds{stream="em-sync-buffer"}` | Age of the oldest entry still in the stream |

At Tier 2+, `fm_internal_events_total{event="..."}` also counts
`em_sync_push_batches` (Redis calls that added pushed records; pushes divided
by calls is the batch size) and `em_sync_pull_deferred` (pull passes that got
no page before their deadline because the em-sync connections were busy; the
device is queued again at once). `fm_internal_values{metric="..."}` reports
`em_sync_pull_pages_waiting` (pulls waiting for room to fetch a page) and
`em_sync_pull_writes_waiting` (fetched pages waiting for an em-sync
connection). Fetched pages wait in Fleet, not in the pool, so a long queue
there never shows as pool checkout timeouts.

### Redis at maxmemory

With `noeviction`, Redis refuses every command flagged `denyoom` once it is
over `maxmemory`: writes such as `XADD`, `SET`, `XGROUP CREATE` (even for a
group that exists) and `SUBSCRIBE`. Reads, `XREADGROUP`, `XACK`, `XDEL` and
`XAUTOCLAIM` still work, so draining a stream frees memory. Fleet keeps
serving: the web server starts, a stream consumer whose group exists drains,
and a leader lease is taken by a script flagged `allow-oom`. A consumer whose
group is missing, or a subscription Redis refused, retries in the background.
While anything retries, `GET /health/ready` reports `redis` as `degraded`
(readiness stays 200, Redis is not required) and `/health/full` sets
`degraded: true` with `redisWaiting`.

| Metric | Meaning |
|---|---|
| `fm_redis_stream_group_waiting{source}` | 1 while a stream consumer cannot read because its group is not set up; 0 once it is |
| `fm_redis_stream_group_setup_errors_total{source,reason}` | Failed group setups. `reason` is `oom` (Redis at maxmemory) or `error`. Each one is also logged at `error` |
| `fm_device_gui_revocation_subscribe_errors_total` | Failed subscriptions to device GUI session revocations. Until one succeeds, a session replaced on another instance stays open on this one |

### Formatted PDF Capacity and Performance

Formatted PDF rendering shares the durable report-worker pool. Ordinary
Latin-script reports use the fast font path; complex-script rows additionally
run the shaped visual and semantic extraction path. The default render budget
is 30 seconds and can be tuned with `FM_REPORT_PDF_RENDER_BUDGET_MS` (minimum
1,000 ms). A budget breach records telemetry and a warning; it does not publish
an incomplete artifact or cancel a render that is still within the report job's
normal lifecycle.

| Metric | Meaning |
| --- | --- |
| `fm_report_worker_capacity_available` | Configured durable worker slots not occupied by report exports |
| `fm_report_worker_saturated` | `1` while report exports occupy every configured durable worker slot |
| `fm_report_pdf_render_budget_seconds` | Effective per-document render budget |
| `fm_report_pdf_renders_active` | PDF renders currently active in this process |
| `fm_report_pdf_last_render_duration_seconds` | Duration of the latest completed or failed render |
| `fm_report_pdf_last_complex_rows` | Complex-script rows in the latest render |
| `fm_report_pdf_render_duration_seconds_total` | Cumulative render time for rate/average calculations |
| `fm_report_pdf_render_samples_total` | Number of completed or failed render observations |
| `fm_report_pdf_render_budget_exceeded_total` | Renders that exceeded the configured budget |
| `fm_report_pdf_render_failures_total` | Renders that failed before publication |
| `fm_report_pdf_complex_documents_total` | Documents that used the complex-script path |
| `fm_report_pdf_complex_rows_total` | Complex-script rows rendered across all documents |

Alert on sustained worker saturation together with queue growth, and on a
non-zero rate of budget breaches or render failures. Use
`fm_report_pdf_render_duration_seconds_total /
fm_report_pdf_render_samples_total` for the process-wide mean. The latest gauge
is diagnostic, not a percentile.

### Audit Log Tab

The Audit Log tab is visible when devMode is enabled or when the observability level is greater than 0 (`obsLevel > 0`). This provides access to the audit trail without requiring full observability to be enabled.

## Debugging Common Issues

### Identifying Bottleneck Modules

1. Enable **Medium** tier
2. Open the **Modules** collapse panel
3. Look for yellow/red cards, these indicate modules under stress
4. Check **RPC Timings** for slow methods (>200ms yellow, >1s red)
5. Check **DB Timings** for slow database queries
6. Check **RPC Errors** panel for recurring method failures and their error messages
7. Use counter rate-of-change indicators to spot rapidly incrementing error counters

### High Event Loop Lag

- EL Lag > 50ms (yellow) or > 100ms (red) indicates the Node.js event loop is blocked
- Check `statusQueue.queueSize`, large queues mean status updates are backing up
- Check `deviceInit.active`, many concurrent device initializations can block the loop

### Memory Issues

- Monitor RSS and Heap in the vitals bar
- Watch the **heap trend arrow**: a persistent red up-arrow indicates a potential memory leak
- If Heap Used approaches Heap Total, garbage collection pressure is high
- Check `events.groupCacheSize`, large group caches consume memory (24h TTL)
- Use **Export Report** to capture a full snapshot for offline analysis

### Device Connectivity Issues

- Check `devices.total` vs expected count
- Compare `devices_connected` vs `devices_disconnected` counters
- Check `device_inits_failed` for initialization errors
- A device that connects but never registers: grep its shellyID in the log for `gather-failed`, and check `device_gather_abandoned_total` by `reason`
- Open the **Init Failures** panel to see the last 50 failures with device IDs and error messages
- Use Device GUI modal diagnostics + RPC timings for per-device debugging

### Capturing a Full Debug Snapshot

1. Click **Export Report** in the toolbar to download a JSON file
2. The report includes backend state, frontend metrics, current logs, and browser info
3. Share this file when reporting bugs or requesting support
4. Pin important log entries before exporting, they will be clearly visible in the pinned section

### Using Keyboard Shortcuts for Fast Triage

- Press `Ctrl+K` / `Cmd+K` to quickly search logs for error patterns
- Press `Ctrl+L` / `Cmd+L` to clear logs when starting a fresh investigation
- Press `Escape` to clear the search and return to the full log view
- Pin relevant error logs as you find them for easy reference

## Adding New Module Stats

To add observability to a new module:

```typescript
import * as Observability from './Observability';

// 1. Register a stat getter (called on /health poll, Tier 1+)
Observability.registerModule('myModule', () => ({
    total: myMap.size,
    active: activeCount,
}));

// 2. Add counters at key code points (Tier 2+)
Observability.incrementCounter('my_module_processed');
Observability.incrementCounter('my_module_errors');
```

No frontend changes needed, the module grid and counters automatically pick up new entries from the backend `/health` response.
