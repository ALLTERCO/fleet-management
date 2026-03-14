# Observability & Debug System

The Fleet Management application includes a built-in observability system for monitoring, debugging, and identifying performance bottlenecks in production. The system uses **tiered debug levels** to control overhead, allowing safe use even on large instances with thousands of devices.

## Container Log Viewer (Dozzle)

For Docker container-level logs, the deploy script supports an optional [Dozzle](https://dozzle.dev) integration:

```bash
# Public deploy
./deploy/deploy-public.sh up --logging

# Internal deploy
./deploy/deploy.sh up --env local --with logging
```

Dozzle runs on port 9999 and provides a browser-based, real-time view of all container logs. It is read-only and zero-config — no configuration files or persistent storage needed. It reads logs directly from the Docker socket.

This complements the application-level observability system described below, which provides structured metrics, counters, and timings from inside Fleet Manager.

---

## Debug Tiers

| Level | Name | Overhead | What It Shows | Production Safe? |
| ----- | ---- | -------- | ------------- | --------------- |
| 0 | OFF | Zero | Logs only | Yes |
| 1 | Light | Negligible | System vitals + module gauges | Yes |
| 2 | Medium | Low | Light + counters + RPC/DB timings | Yes |
| 3 | Full | Moderate | Medium + WS msg/s + pending RPCs + client ring buffer | Use with caution |

**Key design principle:** Each recording function checks `if (level < requiredTier) return;` — a single integer comparison — so disabled tiers have effectively zero overhead. Module stat getters only run when `/health` is polled (not on every message).

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

```bash
# Set level
curl -X POST /health/observability -H 'Content-Type: application/json' -d '{"level": 2}'

# Legacy boolean (backward compatible)
curl -X POST /health/observability -H 'Content-Type: application/json' -d '{"enabled": true}'

# Reset all timings and counters
curl -X POST /health/observability/reset

# Get current metrics
curl /health
```

## Backend Architecture

### Observability.ts (Core Module)

Located at `backend/src/modules/Observability.ts`. Central metrics collection with three mechanisms:

1. **Module Getters** (Tier 1+): Modules register lightweight stat-getter functions that read `.size` from existing Maps — O(1), no iteration. Only called when `/health` is polled.

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
| dbPool | `total`, `idle`, `waiting` (connection pool stats) | Database pool (if pg pool is accessible) |

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
| `events_broadcast` | EventDistributor.notifyAll() | 2 |
| `rpc_success` | Commander.exec() success | 2 |
| `rpc_errors` | Commander.exec() error | 2 |

### Health Endpoint Response

`GET /health` returns metrics based on the current observability level:

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
      "rpcCommands": { "registered": 28 },
      "dbPool": { "total": 10, "idle": 8, "waiting": 0 }
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

When the PostgreSQL connection pool is accessible, the `dbPool` module is registered in the observability system and reports:

- `total`: Total number of connections in the pool
- `idle`: Number of idle (available) connections
- `waiting`: Number of queued requests waiting for a connection

These stats appear automatically in the Modules grid at Tier 1+. High `waiting` counts indicate the pool is saturated and queries are being delayed.

### Audit Log Tab

The Audit Log tab is visible when devMode is enabled or when the observability level is greater than 0 (`obsLevel > 0`). This provides access to the audit trail without requiring full observability to be enabled.

## Debugging Common Issues

### Identifying Bottleneck Modules

1. Enable **Medium** tier
2. Open the **Modules** collapse panel
3. Look for yellow/red cards — these indicate modules under stress
4. Check **RPC Timings** for slow methods (>200ms yellow, >1s red)
5. Check **DB Timings** for slow database queries
6. Check **RPC Errors** panel for recurring method failures and their error messages
7. Use counter rate-of-change indicators to spot rapidly incrementing error counters

### High Event Loop Lag

- EL Lag > 50ms (yellow) or > 100ms (red) indicates the Node.js event loop is blocked
- Check `statusQueue.queueSize` — large queues mean status updates are backing up
- Check `deviceInit.active` — many concurrent device initializations can block the loop

### Memory Issues

- Monitor RSS and Heap in the vitals bar
- Watch the **heap trend arrow**: a persistent red up-arrow indicates a potential memory leak
- If Heap Used approaches Heap Total, garbage collection pressure is high
- Check `events.groupCacheSize` — large group caches consume memory (24h TTL)
- Use **Export Report** to capture a full snapshot for offline analysis

### Device Connectivity Issues

- Check `devices.total` vs expected count
- Compare `devices_connected` vs `devices_disconnected` counters
- Check `device_inits_failed` for initialization errors
- Open the **Init Failures** panel to see the last 50 failures with device IDs and error messages
- Use Device GUI modal diagnostics + RPC timings for per-device debugging

### Capturing a Full Debug Snapshot

1. Click **Export Report** in the toolbar to download a JSON file
2. The report includes backend state, frontend metrics, current logs, and browser info
3. Share this file when reporting bugs or requesting support
4. Pin important log entries before exporting — they will be clearly visible in the pinned section

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

No frontend changes needed — the module grid and counters automatically pick up new entries from the backend `/health` response.
