<!-- audience: public -->
# Fleet Manager: Performance Tuning Guide

All tuning variables are set via environment variables in your `.env` file.
Defaults are conservative: tuned for small/medium fleets on modest hardware.
Large fleets or EM-heavy installations **must** adjust these values.

## Quick Reference

| Variable | Default | What it controls |
|---|---|---|
| `FM_HEAP_SIZE` | 1024 | Node.js heap size in MB |
| `FM_STATUS_QUEUE_MAX` | 50000 | Max buffered device status messages before dropping |
| `FM_STATUS_FLUSH_INTERVAL_MS` | 250 | How often status messages are flushed to the DB (ms) |
| `FM_MAX_CONCURRENT_INITS` | 100 | Parallel device initializations on (re)connect |
| `FM_DEVICE_INIT_QUEUE_MAX` | 1000 | Init waiting-queue sizing input |
| `FM_DEVICE_INIT_QUEUE_HIGH_WATER_PCT` | 70 | Percentage of the queue sizing input that may actually wait |
| `FM_DEVICE_INIT_QUEUE_MAX_WAIT_MS` | 30000 | Maximum time an init may wait for a local slot |
| `FM_DEVICE_INIT_SLOT_MAX_HOLD_MS` | 90000 | Watchdog threshold for a held local init slot |
| `FM_WAITING_GATHER_MAX_MS` | 60000 | Hard deadline for one waiting-room device gather (every probe RPC included) |
| `FM_WAITING_GATHER_TAKE_MS` | 60000 | How long an accept waits on a running gather before probing fresh |
| `FM_DEVICE_INITS_CLUSTER_CAP` | 0 | Cluster-wide concurrent init cap (`0` disables it) |
| `FM_WS_ADMISSION_MAX_PER_SEC` | 0 | Process WebSocket admission burst cap (`0` disables it) |
| `FM_MAX_CONCURRENT_EM_SYNCS` | 40 | Parallel energy meter historical data syncs |
| `FM_RPC_TIMEOUT_MS` | 60000 | Timeout for a single device RPC call (ms) |
| `FM_DB_CONNECTIONS` | 37 | Whole PostgreSQL connection budget of one process: the shared pool plus the outbox pool |
| `FM_DB_QUERY_STATEMENT_TIMEOUT_MS` | 30000 | Statement timeout for every call on the shared pool |
| `FM_DB_FOREGROUND_RESERVE` | 1 | Shared-pool connections that only user requests may take |
| `FM_DB_IDLE_TIMEOUT_MS` | 60000 | Idle time before a pooled connection is closed |
| `FM_DB_POOL_MIN` | 2 | Idle shared-pool connections never closed for idleness |
| `FM_DB_POOL_MAX_LIFETIME_S` | 1800 | Age at which a pooled connection is replaced |
| `FM_DB_ALERT_MAX_CONNECTIONS` | 2 | Most shared-pool connections alert work may hold at once |
| `FM_ALERT_FIRE_BATCH_MAX_ROWS` | 200 | Most alerts saved together in one database transaction |
| `FM_ALERT_FIRE_BATCH_TICK_MS` | 200 | Longest a new alert waits to be saved together with others (ms) |
| `FM_ALERT_STATE_RECHECK_MIN_MS` | 300000 | Least age of remembered alert state before it is read again; bounds a missed peer signal |
| `FM_ALERT_STATE_RECHECK_SPREAD_MS` | 600000 | Random spread added to that age so re-reads do not all happen at once |
| `FM_DB_ENERGY_WRITE_MAX_CONNECTIONS` | 1 | Most shared-pool connections live energy saves may hold at once |
| `FM_DB_EMSYNC_MAX_CONNECTIONS` | 1 | Shared-pool connections the saving of meter history (em-sync) always gets. It may borrow idle ones beyond that, up to the shared pool size minus `FM_DB_FOREGROUND_RESERVE` minus 1 |
| `FM_DB_ROLLUP_MAX_CONNECTIONS` | 1 | Most shared-pool connections the 15-minute energy rollup may hold at once |
| `FM_EMSYNC_STREAM_MAX_BYTES` | 134217728 | Byte budget of the Redis buffer for meter records the meters push (128 MiB). A push past it is refused and filled by the next pull |
| `FM_EMSYNC_CATCHUP_HIGH_WATER_PCT` | 75 | History pulls pause while the push buffer holds this percent of its byte budget |
| `FM_EMSYNC_PULL_PAUSE_AGE_MS` | 60000 | History pulls pause while the oldest buffered push is older than this (ms) |
| `FM_EMSYNC_PULL_PAGES_PER_CONNECTION` | 2 | History pages fetched or being saved per em-sync connection; a pull asks a meter for a page only when it fits (1 to 16) |
| `FM_EMSYNC_PUSH_BATCH_MS` | 100 | Longest a pushed meter record waits to share one Redis call with others (ms, 0 to 1000) |
| `FM_EMSYNC_PUSH_BATCH_MAX_ENTRIES` | 500 | Most pushed records in one Redis call; a full batch is sent at once (1 to 5000) |
| `FM_EMSYNC_STREAM_MAXLEN` | 2000000 | Most entries the push buffer holds; a backstop behind the byte budget |
| `FM_EM_HELD_CORRECTION_DAYS` | 7 | Days a held 15-minute energy bucket keeps its raw readings before it is set aside with a copy of them |
| `FM_EM_ROLLUP_CLOSE_GRACE_MS` | 180000 | Wait after an open meter-record bucket ends before it is computed anyway, when the meter's records have not reached its end (ms, 0 to 3600000) |
| `FM_EM_ROLLUP_LATE_DEBOUNCE_MS` | 30000 | Wait before a late meter record makes its closed bucket be computed again, so a burst of late minutes gives one recompute (ms, 0 to 3600000) |
| `FM_EM_LIVE_DEBUG_HOURS` | 4 | Hours a live EM debug capture runs before it stops and deletes what it captured (1 to 24) |
| `FM_EMDATA_PULL_GRACE_MS` | 120000 | A meter channel is pulled once its complete-up-to time is older than this (ms) |
| `FM_EM_COMPLETENESS_INTERVAL_MS` | 3600000 | How often the meter history completeness check runs (ms) |
| `FM_EM_COMPLETENESS_SETTLE_MS` | 1800000 | Holes younger than this are left to the gap fill (ms) |
| `FM_EM_COMPLETENESS_MAX_SPAN_MS` | 86400000 | Longest range the check scans per channel per run (ms) |
| `FM_EM_COUNTER_CHECK_LOOKBACK_MS` | 86400000 | Window of counter points the check compares (ms) |
| `FM_EM_COUNTER_CHECK_TOLERANCE_PCT` | 2 | Allowed mismatch between counter points and stored energy (percent) |
| `FM_MAX_PENDING_RPCS` | 10 | Max queued RPC calls per device |
| `FM_AUDIT_FLUSH_INTERVAL_MS` | 2000 | How often audit log entries are flushed to DB (ms) |
| `FM_AUDIT_QUEUE_MAX` | 100 | Max buffered audit log entries |
| `FM_DEVICE_CACHE_TTL_MS` | 5000 | Device list cache TTL (ms) |
| `FM_GRAFANA_PROXY_TIMEOUT_MS` | 30000 | Upstream Grafana fetch timeout (ms) |
| `FM_GRAFANA_PROXY_MAX_BYTES` | 52428800 | Max proxied Grafana response size in bytes (default 50 MB) |
| `FM_LOG_BUFFER_MAX` | 2000 | Frontend: max log entries kept in the in-memory console buffer |
| `FM_LOG_CATEGORY_MAX` | 100 | Frontend: max distinct log4js categories shown in filter UI |
| `FM_AUDIT_PAGE_SIZE` | 100 | Frontend: page size for `/monitoring/audit-log` search |
| `FM_WS_HEARTBEAT_MS` | 30000 | WS ping interval ms |
| `FM_WS_HEARTBEAT_MISSED_PONGS_MAX` | 2 | Consecutive missed pongs before disconnect |
| `FM_WS_AUTH_QUEUE_MAX` | 25 | Messages buffered during token auth window |
| `FM_WS_STREAM_PREFIX` | `fm:evt` | Per-session Redis Stream key prefix |
| `FM_REDIS_WRITE_MAX_PENDING_COMMANDS` | `512` | Reject new best-effort Redis writes while the shared command client already has this many pending commands; prevents timed-out writes from growing ioredis and Redis client-output buffers without bound (`0` disables) |
| `FM_WS_STREAM_MAXLEN` | 10000 | Per-session stream MAXLEN trim point |
| `FM_WS_STREAM_TTL_MS` | 3600000 | Stream TTL (1h): safety expiry; the replay window is `FM_WS_RESUME_GRACE_MS` |
| `FM_WS_RESUME_GRACE_MS` | 60000 | After a socket drops, keep recording its events this long so a reconnect replays the gap (capped at the TTL; `0` = off) |
| `FM_WS_RESUME_MAX_EVENTS` | 5000 | Max events recorded during the gap (capped at MAXLEN); more makes the reconnect resync instead |
| `FM_WS_RESUME_PROBE_MS` | 2000 | Ping wait before a reconnect takes over a session whose old socket looks half-open |
| `FM_WS_STREAM_BLOCK_MS` | 1000 | Sender XREADGROUP BLOCK ms |
| `FM_WS_STREAM_BATCH_SIZE` | 100 | Sender XREADGROUP COUNT |
| `FM_WS_SENDER_PAUSE_BYTES` | 1048576 | bufferedAmount above which sender loop pauses |
| `FM_WS_LOG_FLUSH_MS` | 250 | WS log appender debounce ms |
| `FM_WS_CLIENT_COMPRESSION_ENABLED` | true | Compress large messages on the browser and API socket |
| `FM_WS_CLIENT_COMPRESSION_THRESHOLD` | 4096 | Browser socket messages smaller than this many bytes are sent as is |
| `FM_WS_CLIENT_COMPRESSION_WINDOW_BITS` | 14 | Browser socket compression window (9 to 15); lower uses less memory per socket |
| `FM_WS_COMPRESSION_ENABLED` | false | Compress messages on the device `/shelly` socket |
| `FM_HTTP_SOCKET_TIMEOUT_MS` | 120000 | HTTP idle socket timeout ms |
| `FM_HTTP_KEEP_ALIVE_TIMEOUT_MS` | 95000 | Idle keep-alive close ms; keep above the proxy idle timeout |
| `FM_WAITING_ROOM_MAX` | 2000 | Max pending devices in memory (LRU cap) |
| `FM_WAITING_ROOM_MAX_PER_ORG` | 2000 | Max pending devices retained for one organization |
| `FM_WAITING_ROOM_TTL_MS` | 3600000 | Pending device TTL ms (1 hour) |
| `FM_WAITING_ROOM_SWEEP_MS` | 60000 | TTL sweep interval ms |
| `FM_DEVICE_ACCESS_RECHECK_MS` | 60000 | How often each process rechecks devices whose access was taken away, ms |
| `FM_WAITING_ROOM_NOTIFY_DEBOUNCE_MS` | 300 | Update event debounce ms |
| `FM_WAITING_ROOM_ENRICH_TIMEOUT_MS` | 5000 | Enrichment RPC timeout ms |
| `FM_WAITING_ROOM_RECONNECT_KEY_MAX` | 10000 | Reconnect limiter shellyID cap |
| `FM_WAITING_ROOM_RECONNECT_WINDOW_MS` | 60000 | Reconnect limiter sliding window ms |
| `FM_WAITING_ROOM_RECONNECT_MAX_PER_WINDOW` | 20 | Max reconnect attempts per window |
| `FM_WAITING_ROOM_RECONNECT_BLOCK_MS` | 300000 | Block duration after limit exceeded ms |
| `FM_BLU_PROVENANCE_RETENTION_DAYS` | 30 | Days the record of which gateway relayed each BLU sample is kept |

## How the Status Pipeline Works

```text
Device ──NotifyStatus──► statusSelectivePush() ──► pendingMessages[] buffer
                                                          │
                                            every FM_STATUS_FLUSH_INTERVAL_MS
                                                          │
                                                          ▼
                                              processPendingMessages()
                                              (previous values from the change list)
                                                          │
                                                          ▼
                                              fn_status_push() → TimescaleDB
                                              (bulk INSERT via unnest arrays)
```

1. Each `NotifyStatus` is merged into the device held in memory. The message is
   buffered with the list of fields that changed (O(1), <1μs).
2. Every flush interval, the buffer is drained and processed.
3. A field in the change list takes its previous value from that list. A field
   not in the list kept its value. The flush never reads the database for a
   previous value.
4. When a device connects again, its full status is compared with the last
   status held for it. That difference counts the energy used while it was
   offline. It is also written to the device event log with source `reconnect`.
   After a restart, the held status is the one saved in the device row. Fleet
   Manager saves that row again during a normal shutdown.
5. Processed rows are bulk-inserted into `device.status` via a single DB call.

**If the DB is slow** (flush takes longer than the interval), the next tick is
skipped (`statusFlushInProgress` guard). Messages accumulate in the buffer.
When `FM_STATUS_QUEUE_MAX` is reached, new messages are **dropped** and the
`status_queue_drops` counter increments (visible in `/health/debug-report`).

## Fleet Profiles

### Small: up to 300 mixed devices (RPi 5, 8GB)

The defaults work out of the box. No changes needed.

```env
FM_HEAP_SIZE=1024
# All FM_ tuning vars: use defaults (leave unset)
PG_SHARED_BUFFERS=256MB
PG_EFFECTIVE_CACHE=512MB
PG_MAX_CONNECTIONS=100
```

- Status rate: ~30 msgs/sec
- DB writes: ~300 rows/sec
- Queue headroom: ~28 minutes of buffer if DB stalls

### Medium: 500-1000 mixed devices (16GB server)

```env
FM_HEAP_SIZE=2048
# FM_ tuning: defaults are fine, but monitor status_queue_drops
PG_SHARED_BUFFERS=512MB
PG_EFFECTIVE_CACHE=1GB
PG_MAX_CONNECTIONS=200
```

- Status rate: 50-100 msgs/sec
- DB writes: ~500-1000 rows/sec
- Queue headroom: 8-16 minutes of buffer

### Large: 2000-5000 mixed devices (32GB server)

```env
FM_HEAP_SIZE=4096
FM_MAX_CONCURRENT_INITS=200
FM_MAX_CONCURRENT_EM_SYNCS=60
FM_STATUS_QUEUE_MAX=100000
PG_SHARED_BUFFERS=1GB
PG_EFFECTIVE_CACHE=2GB
PG_WORK_MEM=8MB
PG_MAX_CONNECTIONS=300
```

- Status rate: 200-500 msgs/sec
- DB writes: 2,000-5,000 rows/sec
- Queue headroom: 3-8 minutes of buffer
- Init queue: 5,000 devices ÷ 200 concurrent = 25 batches × ~3s = ~75s total

### EM-Heavy: 3-phase energy meters

#### Measured DB rows per NotifyStatus (simulated with flattie + floatFieldMap)

| Device | Mode | Status rows | EM stats rows | Total rows/msg |
|---|---|---|---|---|
| **Pro 3EM** | triphase | 32 | 9 | **41** |
| **Pro 3EM** | monophase (3 channels) | 30 | 9 | **39** |
| **Plus 1PM** | n/a | 13 | 4 | **17** |
| **EM1** | n/a | 10 | 3 | **13** |
| **Pro EM** (single-phase em:0) | n/a | ~7 | ~3 | **~10** |

**Triphase** (em:0 with a\_/b\_/c\_ fields): 3 phases × 6 fields + 4 totals
\+ neutral + 9 emdata energy counters + 2 IDs = 32 status rows.
Plus 9 em\_stats rows (current, voltage, power per phase).

**Monophase** (em:0, em:1, em:2 as independent channels): 3 channels × 7
fields + 3 × 3 emdata fields = 30 status rows.
Plus 9 em\_stats rows (current, voltage, power per channel, phase=z).

#### Reporting frequency

Shelly devices send `NotifyStatus` on the configured `sys.report_period`:

| Setting | Typical use case |
|---|---|
| 60s (default) | General monitoring |
| 30s | Active energy dashboards |
| 10s | Real-time power optimization |
| 5s | High-frequency metering (unusual) |

#### Scaling table: Pro 3EM @ 41 rows per NotifyStatus

| Devices | Report interval | msgs/sec | rows/sec | rows/250ms batch | Queue buffer (50k) | Queue buffer (200k) |
|---|---|---|---|---|---|---|
| 100 | 60s | 1.7 | 70 | 17 | 8+ hours | 32+ hours |
| 500 | 30s | 17 | 697 | 174 | 50 min | 3+ hours |
| 500 | 10s | 50 | 2,050 | 512 | 17 min | 67 min |
| 1,000 | 10s | 100 | 4,100 | 1,025 | 8 min | 33 min |
| 2,000 | 10s | 200 | 8,200 | 2,050 | 4 min | 17 min |
| 5,000 | 10s | 500 | 20,500 | 5,125 | 100 sec | 7 min |
| 5,000 | 5s | 1,000 | 41,000 | 10,250 | 50 sec | 3.3 min |

Queue buffer = time until message drops begin IF the DB completely stalls.
In normal operation the queue stays near zero. The queue counts **messages**
(not rows), so 50k queue = 50,000 messages regardless of rows per message.

#### Scaling table: EM sync handler (historical data via RPC)

The EM sync runs on a 9-minute cycle. Each sync does 2-4 RPC calls to the
device + DB inserts. Total cycle time = `devices ÷ concurrent × ~3s`.

| Devices | Concurrent (default 40) | Cycle time | Within 9min? | Recommended |
|---|---|---|---|---|
| 100 | 40 | 8s | Yes | defaults |
| 500 | 40 | 38s | Yes | defaults |
| 1,000 | 40 | 75s | Yes | defaults |
| 2,000 | 40 | 150s | Yes | defaults |
| 2,000 | 80 | 75s | Yes | `FM_MAX_CONCURRENT_EM_SYNCS=80` |
| 5,000 | 40 | 375s | Yes (tight) | `FM_MAX_CONCURRENT_EM_SYNCS=80` |
| 5,000 | 100 | 150s | Yes | `FM_MAX_CONCURRENT_EM_SYNCS=100` |

#### Reconnect after a restart

Fleet Manager loads every saved device into memory before it accepts device
connections. When a device connects again, its status is compared in memory
with the saved one. No database query runs per device or per field, so status
processing has no warmup cost after a restart.

#### Recommended settings by fleet size

**500 Pro 3EM @ 10s reporting:**

```env
FM_HEAP_SIZE=1024
# All FM_ tuning: use defaults
PG_SHARED_BUFFERS=256MB
PG_EFFECTIVE_CACHE=512MB
PG_MAX_CONNECTIONS=100
```

- 2,050 rows/sec: defaults handle this fine

**1,000 Pro 3EM @ 10s reporting:**

```env
FM_HEAP_SIZE=2048
FM_MAX_CONCURRENT_EM_SYNCS=60
FM_STATUS_QUEUE_MAX=100000
PG_SHARED_BUFFERS=512MB
PG_EFFECTIVE_CACHE=1GB
PG_MAX_CONNECTIONS=200
```

- 4,100 rows/sec: increase queue for headroom during DB maintenance

**2,000 Pro 3EM @ 10s reporting:**

```env
FM_HEAP_SIZE=4096
FM_MAX_CONCURRENT_INITS=200
FM_MAX_CONCURRENT_EM_SYNCS=80
FM_STATUS_QUEUE_MAX=200000
FM_STATUS_FLUSH_INTERVAL_MS=500
PG_SHARED_BUFFERS=1GB
PG_EFFECTIVE_CACHE=2GB
PG_WORK_MEM=8MB
PG_MAX_CONNECTIONS=300
```

- 8,200 rows/sec: 500ms flush interval for larger, more efficient batches
- Dedicated 16GB+ server recommended

**5,000 Pro 3EM @ 10s reporting:**

```env
FM_HEAP_SIZE=8192
FM_MAX_CONCURRENT_INITS=300
FM_MAX_CONCURRENT_EM_SYNCS=100
FM_MAX_PENDING_RPCS=20
FM_STATUS_QUEUE_MAX=500000
FM_STATUS_FLUSH_INTERVAL_MS=500
FM_RPC_TIMEOUT_MS=120000
PG_SHARED_BUFFERS=2GB
PG_EFFECTIVE_CACHE=4GB
PG_WORK_MEM=16MB
PG_MAINT_WORK_MEM=256MB
PG_MAX_CONNECTIONS=400
STATUS_RETENTION=7 days
```

- 20,500 rows/sec sustained: dedicated 32GB+ server with SSD required
- Monitor `statusQueue.drops`: if non-zero, DB can't keep up

**5,000 Pro 3EM @ 5s reporting (extreme):**

```env
FM_HEAP_SIZE=8192
FM_MAX_CONCURRENT_INITS=300
FM_MAX_CONCURRENT_EM_SYNCS=100
FM_MAX_PENDING_RPCS=20
FM_STATUS_QUEUE_MAX=500000
FM_STATUS_FLUSH_INTERVAL_MS=500
FM_RPC_TIMEOUT_MS=120000
PG_SHARED_BUFFERS=4GB
PG_EFFECTIVE_CACHE=8GB
PG_WORK_MEM=16MB
PG_MAINT_WORK_MEM=512MB
PG_MAX_CONNECTIONS=400
STATUS_RETENTION=24 hours
```

- 41,000 rows/sec sustained: near the upper bound of a single TimescaleDB
- 64GB+ RAM, NVMe SSD, dedicated DB server recommended
- Consider reducing `STATUS_RETENTION` to `24 hours` to keep the hypertable lean
- If drops persist, the single-node architecture has reached its limit

## What Each Variable Does: In Detail

### FM_STATUS_QUEUE_MAX

The status pipeline buffers incoming device messages in an array. The buffer
is drained every `FM_STATUS_FLUSH_INTERVAL_MS`. If the DB flush takes longer
than the interval (slow disk, heavy query load, vacuuming), messages
accumulate. This cap prevents unbounded memory growth.

**When the cap is hit:** New messages are silently dropped. The
`status_queue_drops` counter increments (visible in observability output).
No crash, no error: but you lose telemetry data points. The device will
send a new status on its next interval, so the gap is short.

**Sizing rule:** `(messages_per_second × max_acceptable_data_loss_seconds)`.
For 1000 msgs/sec and 60s of acceptable data loss: 60,000.

### FM_STATUS_FLUSH_INTERVAL_MS

How often the buffer is processed and flushed to the DB. Lower values mean
smaller batches (less latency) but more frequent DB calls. Higher values mean
larger batches (more efficient bulk inserts) but more memory usage and latency.

For EM-heavy fleets, **500ms is better than 250ms**: the larger batch amortizes
the per-call overhead of `fn_status_push`. Below 100ms is not recommended.

### FM_MAX_CONCURRENT_INITS

When the server starts (or after a network blip), all devices reconnect
simultaneously. Each init does 3 sequential RPC calls to the device +
a DB query + entity generation. This cap prevents event loop saturation.

Devices that exceed the cap are **queued**, not rejected. They initialize
in order, with a `setImmediate` yield between batches.

**Sizing rule:** Keep below `PG_MAX_CONNECTIONS / 2` to leave DB headroom
for other operations (status flushes, EM syncs, API queries).

### FM_MAX_CONCURRENT_EM_SYNCS

Energy meter historical data sync runs on a 9-minute cycle. Each sync does
multiple RPC calls to the device + DB inserts. This cap prevents overwhelming
the device network and DB pool during the sync window.

**Sizing rule:** For N EM devices, the sync window is approximately
`N / FM_MAX_CONCURRENT_EM_SYNCS × 3 seconds`. Keep this under 540 seconds
(the sync cycle threshold) to avoid sync backlog.

### FM_EMSYNC_STREAM_MAX_BYTES and FM_EMSYNC_PULL_PAUSE_AGE_MS

Meter history reaches Fleet two ways. A meter pushes each finished 1-minute
record; Fleet keeps it in a Redis buffer, one record per entry with the
meter's own value list, until the drainer saves it. Fleet also pulls
history pages from the meter to fill what pushes missed. A pulled page is
saved to the database directly, and the next page is asked for only after
that save. The meter keeps its history, so a failed save is pulled again.

The buffer counts the bytes of its entries and key lists in the same Redis
step that adds or deletes them. A push that would pass
`FM_EMSYNC_STREAM_MAX_BYTES` (default 128 MiB) is refused whole; the next
pull of that meter fills the minute. Redis memory is about 1.3 times the
counted bytes (measured: 600 counted bytes take about 756 bytes for a
three-phase record). Keep the budget well below `REDIS_MAX_MEMORY`, which
Redis shares with other data.

Pulls give way to pushes. They pause while the buffer holds
`FM_EMSYNC_CATCHUP_HIGH_WATER_PCT` (default 75) percent of the budget, or
while its oldest entry is older than `FM_EMSYNC_PULL_PAUSE_AGE_MS` (default
60 s), and resume when the drainer catches up. Pulls also pause while other
database work waits for a connection or holds more than
`FM_EMDATA_CATCHUP_POOL_USAGE_PAUSE_PCT` of the pool; em-sync's own
connections do not count. Pulls and the drainer share the em-sync
connections (`FM_DB_EMSYNC_MAX_CONNECTIONS` plus what they borrow). With
several Fleet processes, each pulls the meters connected to it.

### FM_EMSYNC_PULL_PAGES_PER_CONNECTION, FM_EMSYNC_PUSH_BATCH_MS and FM_EMSYNC_PUSH_BATCH_MAX_ENTRIES

A pull asks a meter for a page only when the database can save it soon:
at most `FM_EMSYNC_PULL_PAGES_PER_CONNECTION` (default 2) pages per em-sync
connection are fetched or being saved at once. A fetched page waits for its
connection in Fleet, in arrival order and with no deadline, so it is never
thrown away for want of a connection. Channels furthest behind get the next
page first. A pass that gets no page before its time is up ends and runs
again at once. More pages per connection keep the database busier while
meters answer slowly, and hold more pages in memory.

Pushed records that arrive close together are added to the Redis buffer in
one call: a call goes when `FM_EMSYNC_PUSH_BATCH_MS` (default 100 ms) has
passed since its first record, or at once when it holds
`FM_EMSYNC_PUSH_BATCH_MAX_ENTRIES` (default 500) records. Each push is still
kept whole or refused whole, and its bytes are counted exactly. Meters push
near the same second, so one call per short window keeps the Redis write
limit (`FM_REDIS_WRITE_MAX_PENDING_COMMANDS`) from refusing pushes.

`FM_EMSYNC_STREAM_MAXLEN` (default 2,000,000) still caps the entry count. It
is a backstop only; with one record per entry a low cap would refuse pushes
long before the byte budget.

### FM_EM_HELD_CORRECTION_DAYS

Sometimes Fleet cannot compute a 15-minute energy bucket safely: a reading is
missing, two readings disagree, or late history only covers part of the
bucket. The bucket is then held. A held bucket keeps its raw readings so it
can still be corrected.

Once a held bucket is older than `FM_EM_HELD_CORRECTION_DAYS` (default 7),
the daily raw cleanup copies its raw readings to a separate evidence table,
records the bucket as set aside, and then cleans up raw data as usual. Before
this setting, one held bucket stopped the raw cleanup for good. New readings
for a set-aside bucket make Fleet compute it again. Reports that require
complete data report held or set-aside buckets in their period at once, with
error code 1402, instead of waiting.

A larger value keeps raw readings of held buckets longer, so the raw data on
disk can grow by up to that many days. Fleet hands the value to the database
at start.

### FM_EM_ROLLUP_CLOSE_GRACE_MS and FM_EM_ROLLUP_LATE_DEBOUNCE_MS

An EM meter sends one record per minute. Fleet computes each 15-minute
bucket of these records once, when the bucket is closed, not on every record.
A bucket closes as soon as the meter's records are complete up to its end,
usually a few seconds after the end. If records are missing, it closes
`FM_EM_ROLLUP_CLOSE_GRACE_MS` (default 180000, 3 minutes) after its end and is
shown as incomplete until the missing minutes arrive. Live data (Plus PM and
other devices) is computed on every save, as before.

A record that arrives after its bucket closed makes the bucket be computed
again after `FM_EM_ROLLUP_LATE_DEBOUNCE_MS` (default 30000), so a burst of late
minutes gives one recompute. A late record never delays a bucket that is
already due. Once the meter's records pass the bucket end, the bucket is
computed at once.

Until a bucket is computed, energy reads take the meter's own minute records
for it, so "today" stays current. Sync status counts such buckets as
`rollupScheduledBuckets` with `provisional: true`; reports that require
complete data do not wait for them.

Missing minutes older than the raw data retention are not pulled again. They
stay marked incomplete, never shown as zero.

A larger grace gives slow meters more time but delays the final value of a
bucket with a missing minute. A smaller debounce recomputes more
often during a late burst.

### FM_EM_LIVE_DEBUG_HOURS

EM meters (em and em1) store their 1-minute records as history. Their live
readings are not stored, except frequency. To look at the live values of one
meter, an operator starts a debug capture with `Device.SetEmLiveDebug`. Fleet
then keeps every live em/em1 value of that device in a separate table for
`FM_EM_LIVE_DEBUG_HOURS` (default 4, 1 to 24). Billing, reports and the
15-minute rollup never read that table. When the time is over, or the
operator stops the capture, Fleet deletes the captured values. At most 20
devices per tenant can capture at once. Read them with `Device.GetEmLiveDebug`.

A Pro 3EM sends about 30 values per status message, so a long capture can
hold several hundred thousand rows for one device until it ends.

### FM_RPC_TIMEOUT_MS

Individual RPC call timeout to a device. Devices on congested WiFi or behind
NAT may respond slowly. The default 60s is generous for LAN deployments.
Increase to 120s for cloud-connected devices over cellular/satellite.

### FM_DB_CONNECTIONS

`FM_DB_CONNECTIONS` is every PostgreSQL connection one Fleet Manager process
may open. Default 37. `FM_DB_POOL_MAX` is retired and ignored. Fleet splits
the budget into two pools:

- The outbox pool for graphile-worker. It holds a connection for each running
  delivery job, plus 2 for graphile's own cron and reclaim.
- One shared pool for everything else: stored procedures and plain SQL,
  single calls and transactions, user requests and background work.

| `FM_DB_CONNECTIONS` | Shared pool | Outbox pool | Outbox workers |
|---|---|---|---|
| 5 (minimum) | 2 | 3 | 1 |
| 10 | 6 | 4 | 2 |
| 37 (default) | 30 | 7 | 5 |

The shared pool opens connections only when work needs them and closes a
connection after `FM_DB_IDLE_TIMEOUT_MS` (default 60 s) idle, but keeps at
least `FM_DB_POOL_MIN` (default 2) open. Every pooled connection is replaced
after `FM_DB_POOL_MAX_LIFETIME_S` (default 1800 s). It never opens more than
its size, whichever kind of work asks. The outbox pool uses the same idle
timeout and lifetime.

Some kinds of work have a ceiling on the shared pool:
`FM_DB_ALERT_MAX_CONNECTIONS` (default 2) for alert evaluation and the alert
sweep, `FM_DB_ENERGY_WRITE_MAX_CONNECTIONS` (default 1) for live energy
saves, `FM_DB_EMSYNC_MAX_CONNECTIONS` (default 1) for saving meter history
(em-sync), and `FM_DB_ROLLUP_MAX_CONNECTIONS` (default 1) for the 15-minute
energy rollup. For em-sync the value is its guaranteed share, not a
ceiling: it may borrow connections nothing else waits for, up to the shared
pool size minus `FM_DB_FOREGROUND_RESERVE` minus 1, and gets none beyond its
share while other work waits. With 4 or more CPUs Fleet runs two rollup workers
(`FM_EM_ROLLUP_WORKERS`); at the default rollup ceiling of 1 they take turns.
A ceiling is not a reservation: free connections still serve any work,
and work waiting at its own ceiling does not hold back other work. A value
above the shared pool stops the boot. In a 10-connection run, alert work alone
held 5 connections at once, the whole background share.

Workers that hold a connection for their whole task are capped at the shared
pool size: `FM_ALERT_SWEEP_CONCURRENCY`, `FM_ALERT_DISPATCH_CONCURRENCY`,
`FM_WAITING_ROOM_ACCEPT_CONCURRENCY`, `FM_ENERGY_QUERY_CONCURRENCY` and
`FM_DEVICE_INGRESS_CREDENTIAL_STAGE_CONCURRENCY`. Their defaults shrink to the
pool size when the pool is smaller; a value set above it stops the boot.

Business Manager targets smaller fleets and simpler request patterns. The
September 2026 canary test used a deliberately small pool maximum of 3 with
500 connected simulator devices. After the system settled, every
`Device.List` request succeeded at 1, 2, and 3 requests per second. The pool
had no waiting requests and retained idle capacity. This does not justify a
budget increase.

Review the budget only when settled traffic repeatedly shows one or more of
these conditions:

- `fm_db_pool_waiting` remains above zero for an agreed observation window.
- `fm_db_pool_idle` remains at zero during normal traffic.
- Database-backed requests slow down or time out while pool waiting rises.
- A larger approved fleet or request-rate test fails because work cannot get a
  connection.

Before increasing the budget:

1. Add the budget of every Fleet process, migration connection, monitoring
   connection, and operational reserve on the shared PostgreSQL host.
2. Keep that total below PostgreSQL `max_connections` with explicit headroom.
3. Confirm CPU, memory, disk I/O, and lock headroom. A larger pool can move the
   queue into PostgreSQL and reduce performance.
4. Check whether reconnect admission or background concurrency should be
   bounded instead. A short reconnect surge is not steady user traffic.
5. Change one canary only. Run the same test before and after the smallest
   proposed increase.

### FM_DB_FOREGROUND_RESERVE

How many shared-pool connections only user requests may take. Default 1.
Background work, such as device events, alerts, the event journal and device
saves, may use every other connection, whether it calls a stored procedure or
plain SQL. With `FM_DB_CONNECTIONS=10` that is 5 of 6.
When connections free up, a waiting user request is served before any waiting
background work. So during a large onboarding, an approve or a device list
still gets a connection at once instead of waiting behind hundreds of
background queries.

This does not add connections. `FM_DB_CONNECTIONS` stays the whole budget; the
reserve only decides who may use the connections the pool already has. Fleet
refuses to start if the value leaves background work no connection.

A transaction holds one connection from start to end, and its statements run
on it. A call that would take a second connection from inside an open
transaction fails at once with `DB_TRANSACTION_SECOND_CONNECTION`, on either
path, because it could wait forever for connections held by transactions that
wait for it.

Watch `fm_db_pool_waiting_foreground`. If it stays above zero, user requests
themselves fill the pool; raise the reserve only if background work is the
one holding connections. The waiting total (`fm_db_pool_waiting`) includes
both kinds. A wait ends after `FM_DB_CONNECT_TIMEOUT_MS`.

### FM_ALERT_FIRE_BATCH_MAX_ROWS and FM_ALERT_FIRE_BATCH_TICK_MS

When alerts fire, Fleet saves them together. It collects the alerts of a short
moment and writes them in one database transaction, with their inbox entries,
their notifications and the time they were last sent. This uses far fewer
transactions than saving each alert alone.

- `FM_ALERT_FIRE_BATCH_TICK_MS` (default 200): the longest a new alert waits
  for others before it is saved. A fired alert reaches the screen and the
  notification queue up to this much later. `0` saves as soon as possible.
- `FM_ALERT_FIRE_BATCH_MAX_ROWS` (default 200): the most alerts in one
  transaction. A full batch is saved at once, without waiting.

Two changes of the same alert are never saved in one transaction. The second
waits for the first, so repeat and quiet-time rules behave as before. One save
runs at a time; a second starts only while alerts are already waiting longer
than the tick. If one alert cannot be saved, Fleet saves the others and reports
only that one as failed.

To save each alert alone, as before, set `FM_ALERT_FIRE_BATCH_MAX_ROWS=1` and
`FM_ALERT_FIRE_BATCH_TICK_MS=0`. Watch `fm_alert_fire_batch_rows`,
`fm_alert_fire_batch_flush_seconds` and `fm_alert_fire_queue_wait_seconds`
(see the observability reference).

### FM_DB_TIMING_DETAIL

Splits every database call into its parts for a load run: waiting for the
priority gate, waiting for a connection, the round trip, the hop back to the
caller, and how long the connection was held. It also turns on a 1 ms
event-loop delay window. Default `false`. Recording needs observability level
2 or higher.

Cost, measured on an Apple M1 Pro laptop (micro-benchmark, no database):

| | Node 24 (image) | Node 26 |
|---|---|---|
| Stored-procedure call, off / on | +0.2 µs / +2.9 µs | +0.2 µs / +2.2 µs |
| `queryRows` call, on (reads the caller's name) | +9.5 µs | +6.0 µs |
| 1 ms loop-delay timer | about 1.7% of one core | about 1% of one core |
| Scrape, 150 methods with 2 phases each | 0.5 ms, 62 KiB -> 3.8 ms, 727 KiB | 0.5 ms -> 3.3 ms |

The timer and the larger scrape are why it is off by default. Turn it on for
a measured run, then off again. Metric names are in
[observability](../../reference/observability.md#database-call-phases).

### FM_MAX_PENDING_RPCS

Max concurrent RPC calls in flight to a **single device**. Since device
WebSocket is essentially serial (one outstanding request at a time), this
is a safety net against runaway request queuing. Rarely needs adjustment.

### FM_DEVICE_CACHE_TTL_MS

The device list endpoint caches filtered results per user to avoid
re-filtering on every pagination chunk. Increase for large fleets where
the filtering operation is expensive. Decrease if permissions change
frequently and you need near-instant visibility.

### FM_DEVICE_RELATIONSHIP_QUERY_DEFAULT_LIMIT

Default number of per-device relationship graphs returned by
`device.Relationships.Query` when the caller does not pass `limit`.

### FM_DEVICE_RELATIONSHIP_QUERY_MAX_LIMIT

Maximum number of per-device relationship graphs returned by
`device.Relationships.Query` in one page. Raise carefully for large fleets.

### FM_DEVICE_RELATIONSHIP_DEPTH_TWO_MAX_EXPANSIONS

Maximum number of directly related readable devices expanded when
`device.Relationships.Get` is called with `depth: 2`.

### FM_DEVICE_RELATIONSHIP_DEVICE_SIDE_FAMILY_LIMIT

Maximum number of device-side relationship facts returned per family for one
center device. This caps schedules, scripts, webhooks, local subresources, and
external connection resources before graph assembly.

### FM_GRAFANA_PROXY_TIMEOUT_MS

Aborts the upstream `fetch()` inside `/grafana` proxy requests when the
upstream has not responded within the configured window. Without a cap,
a slow or hung Grafana instance ties up FM request handlers. Raise for
cold-start dashboards that embed heavy queries; lower for interactive
use where fast failure is preferred.

### FM_GRAFANA_PROXY_MAX_BYTES

Ceiling on the response body forwarded from Grafana. If the upstream
streams more than this, FM stops reading, cancels the upstream body,
and logs a truncation warning. Prevents a malicious or misbehaving
upstream from exhausting memory. The default 50 MB fits current Grafana
dashboard payloads with plenty of headroom: increase only if a legitimate
dashboard export regularly exceeds it.

### FM_LOG_BUFFER_MAX

Frontend only. Caps the in-memory log ring used by the Developer console
(`/monitoring/logs`). Older entries are discarded once the cap is hit.
Increase when diagnosing intermittent production issues that need a longer
history; leave at default for day-to-day use.

### FM_LOG_CATEGORY_MAX

Frontend only. Defensive cap on the number of distinct log4js categories
shown in the console category-filter UI. Prevents a misbehaving backend
that emits an unbounded number of category strings from blowing up the
category filter render.

### FM_AUDIT_PAGE_SIZE

Frontend only. Page size used by `/monitoring/audit-log` when the admin
runs a search. Larger values mean fewer pagination round trips but
slower individual responses: tune to match typical audit investigation
workflows.

## WebSocket and HTTP Tunables

### FM_WS_HEARTBEAT_MS

How often the server sends a ping frame to each connected client (ms).
Lower values detect dead sockets faster but increase CPU for large numbers of
concurrent connections. Default 30000 (30 s) is appropriate for most
deployments.

### FM_WS_HEARTBEAT_MISSED_PONGS_MAX

Consecutive heartbeat cycles where no pong was received before the socket is
terminated. Default 2 tolerates one transient network hiccup. If RPCs are in
flight when a pong is missed, the server grants one extra cycle before
disconnecting. Increase only if your network has sustained multi-ping latency
spikes.

### FM_WS_AUTH_QUEUE_MAX

When a client connects, the server validates the auth token before processing
messages. Messages that arrive during that window are buffered up to this cap.
Overflow messages are dropped and the `ws_auth_queue_drops` counter increments.
Default 25 is generous for normal clients; increase if you have automation that
fires many messages immediately on connect.

### FM_WS_STREAM_*

Each WS session gets a Redis Stream `${prefix}:${userId}:${connectionId}`.
`SystemComponent.subscribe` appends events; a per-session sender loop drains
them to the socket and acks. Loss-free under backpressure: the consumer paces
itself, the stream is bounded by `MAXLEN` and TTL: overflow surfaces as a
`RESYNC_REQUIRED` event, never a silent drop.

Variables:

- `FM_WS_STREAM_PREFIX` (default `fm:evt`): key namespace.
- `FM_WS_STREAM_MAXLEN` (default 10000): approximate MAXLEN trim.
- `FM_WS_STREAM_TTL_MS` (default 3600000 = 1 h): safety expiry for an
  abandoned stream key.
- `FM_WS_RESUME_GRACE_MS` (default 60000): after a socket drops, its
  subscriptions keep recording into the stream, with the same permission and
  organization checks as a live socket. A reconnect with the same
  `connectionId` inside this window replays the gap; after it the stream is
  deleted and the reconnect gets `resyncRequired`.
- `FM_WS_RESUME_MAX_EVENTS` (default 5000): gap size limit; past it the
  reconnect gets `resyncRequired: stream_trimmed`, never a partial replay.
- `FM_WS_RESUME_PROBE_MS` (default 2000): when the old socket still looks
  connected, it is pinged; no pong in time means half-open and the new socket
  takes over. A socket that answers keeps its session and the newcomer gets a
  fresh one.
- `FM_WS_STREAM_BLOCK_MS` (default 1000): sender's `XREADGROUP BLOCK` window.
- `FM_WS_STREAM_BATCH_SIZE` (default 100): sender's `XREADGROUP COUNT`.
- `FM_WS_SENDER_PAUSE_BYTES` (default 1 MiB): sender sleeps when
  `socket.bufferedAmount` exceeds this, applying backpressure upstream.

### FM_WS_LOG_FLUSH_MS

Debounce interval for the WebSocket log appender that streams server logs to the
frontend Developer Console. Default 250 ms. Lower values make the log console
feel more real-time; higher values reduce network noise when log volume is high.

### WebSocket compression

The browser socket and the device socket have separate settings.

Browser and API socket (`/`):

- `FM_WS_CLIENT_COMPRESSION_ENABLED` (default `true`). The server agrees to
  `permessage-deflate` when the browser offers it. Web browsers normally
  offer it. A large answer, such as a page of 100 devices (about 400 KB of
  JSON), then crosses the network at about one eighth of its size or less.
- `FM_WS_CLIENT_COMPRESSION_THRESHOLD` (default 4096). Smaller messages are
  sent uncompressed, so small live updates cost no compression CPU.
- `FM_WS_CLIENT_COMPRESSION_WINDOW_BITS` (default 14). The compression
  memory each socket keeps after its first large message. 14 keeps about
  140 KB per socket. 13 keeps about 90 KB but sends larger messages and
  takes longer.

Device socket (`/shelly`):

- `FM_WS_COMPRESSION_ENABLED` (default `false`). Compression is agreed only
  when the connecting device offers it.
- `FM_WS_COMPRESSION_THRESHOLD` (default 512). Device socket messages
  smaller than this are sent as is.

Both sockets:

- `FM_WS_COMPRESSION_LEVEL` (default 1, fastest) and
  `FM_WS_COMPRESSION_MEM_LEVEL` (default 4) set the zlib effort and memory.
- `FM_WS_COMPRESSION_CONCURRENCY_LIMIT` (default 10) caps compression jobs
  running at once in the whole process.

The `fm_ws_compression_total` metric shows, per socket type, how many
connections offered compression and how many agreed to it.

### FM_HTTP_SOCKET_TIMEOUT_MS

Idle socket timeout for the HTTP/HTTPS server. Sockets that have been idle for
longer than this are destroyed. Default 120000 ms (2 minutes). Increase for
large Grafana proxy responses or slow mobile connections; decrease on
low-resource devices to free file descriptors faster.

### FM_HTTP_KEEP_ALIVE_TIMEOUT_MS

How long Fleet keeps an idle keep-alive API connection open after a response.
Default 95000 ms. A proxy in front of Fleet reuses idle connections; if Fleet
closes one first, the proxy can send a request on the closing socket and answer
HTTP 502. Keep this above the proxy's idle timeout (Traefik 90 s by default) and
below `FM_HTTP_SOCKET_TIMEOUT_MS`. Device WebSockets are not affected; device
offline detection uses the WebSocket heartbeat.

## Device Initialization Admission

The local init capacity is not `FM_DEVICE_INIT_QUEUE_MAX` by itself. Fleet
allows `FM_MAX_CONCURRENT_INITS` active initializations plus
`floor(FM_DEVICE_INIT_QUEUE_MAX × FM_DEVICE_INIT_QUEUE_HIGH_WATER_PCT / 100)`
waiting initializations. With the defaults, that is 100 active + 700 waiting =
800 devices admitted to the local init funnel at once.

`FM_DEVICE_INITS_CLUSTER_CAP` provides a Redis-backed cap across Fleet Manager
replicas. `FM_WS_ADMISSION_MAX_PER_SEC` limits the process-level WebSocket
admission burst before devices reach the init funnel. Both safeguards default
to `0` (disabled) for deployment compatibility and must be enabled explicitly.
For a single Fleet Manager instance, the local init cap is sufficient and the
cluster cap only adds a Redis reservation round-trip. For multiple instances,
size the cluster cap deliberately (for example, local cap × expected replicas)
rather than inheriting a product-wide limit that prevents scale-out.

Choosing non-zero product defaults for these safeguards is intentionally
deferred to a separate rollout decision; it is not part of the capacity-path
fixes. Capacity-test environments should set the process admission guard
explicitly and verify its rejection counter.

Every RPC used to assemble a device is bounded by
`FM_DEVICE_INIT_PROBE_TIMEOUT_MS`. `FM_DEVICE_INIT_SLOT_MAX_HOLD_MS` is a
watchdog threshold, not permission to exceed the concurrency cap: reclaimed
work keeps its slot until its canceled continuation has unwound. A slot whose
work has still not unwound one more `FM_DEVICE_INIT_SLOT_MAX_HOLD_MS` after
the reclaim is freed anyway and counted as
`device_init_slot_reclaimed_total{stage="abandoned"}`.

## Waiting Room Tunables

### FM_WAITING_ROOM_MAX

LRU cap on the number of pending devices held in memory. When the cap is
reached, the oldest pending device is evicted (reason: `capacity`). The
`waiting_room_evicted` counter increments and the audit log records the eviction.
Default 2000.

### FM_WAITING_ROOM_MAX_PER_ORG

Per-organization subset of the global waiting-room cap. Default 2000. It must
be no larger than the global capacity needed by a single-organization load
test, otherwise the per-org limit will evict devices first.

### FM_WAITING_ROOM_TTL_MS

Pending devices that have not been approved or denied within this TTL are
evicted (reason: `ttl`). Default 3600000 ms (1 hour). Increase for deployments
where admins may not be available immediately.

### FM_WAITING_ROOM_SWEEP_MS

How often the TTL sweep runs. Default 60000 ms (1 min). Lower values free
memory sooner after TTL expiry; higher values reduce timer overhead in large
fleets.

### FM_DEVICE_ACCESS_RECHECK_MS

How often each Fleet Manager process checks for devices whose access was
taken away (denied, quarantined, set back to pending or deleted). A device still
connected to that process is closed, even if the message about the change
was lost. Default 60000 ms (1 min), so such a device stays connected for at
most about one interval. Each check reads only the changes, one small
read per organization with devices on that process. Lower values close such
devices sooner and read the database more often.

### FM_WAITING_ROOM_NOTIFY_DEBOUNCE_MS

Debounce for the `waiting_room_updated` event sent to frontend clients. During
connection storms many devices connect in quick succession: this prevents a
UI-refresh flood. Default 300 ms.

### FM_WAITING_ROOM_ENRICH_TIMEOUT_MS

Timeout for the enrichment RPC that fetches device info (`Shelly.GetDeviceInfo`)
from a pending device before showing it in the waiting-room UI. Default 5000 ms.
Increase for slow device connections (cellular, satellite).

### FM_WAITING_ROOM_RECONNECT_KEY_MAX

LRU cap on the number of shellyIDs tracked by the reconnect limiter. When full,
the oldest entry is evicted (the device gets a fresh budget). Default 10000.

### FM_WAITING_ROOM_RECONNECT_WINDOW_MS

Sliding window length for the per-device reconnect counter. Default 60000 ms
(1 min). Pair with `FM_WAITING_ROOM_RECONNECT_MAX_PER_WINDOW`.

### FM_WAITING_ROOM_RECONNECT_MAX_PER_WINDOW

Max reconnect attempts a device may make within one window before it is blocked.
Default 20. Covers legitimate reconnects after power cycles; lower to 5–10 if
adversarial hammering is a concern in your deployment.

### FM_WAITING_ROOM_RECONNECT_BLOCK_MS

How long a rate-limited device is blocked after exceeding the reconnect limit.
During the block, `addDevice()` returns `{status: 'rate_limited', retryAfterMs}`
and the device is not added to the pending map. Default 300000 ms (5 min).

### FM_WAITING_GATHER_MAX_MS

Hard deadline for one waiting-room device gather. The whole gather shares one
abort signal, so the deadline, a socket close, or an accept that gives up ends
every probe RPC and pagination loop at once. A gather that is cut is never
cached; the next connection starts a fresh one. Default 60000 ms: three
sequential RPC rounds at `FM_DEVICE_INIT_PROBE_TIMEOUT_MS` each, under the
`FM_DEVICE_INIT_SLOT_MAX_HOLD_MS` watchdog. Check the p99.9 of
`fm_device_ingress_elapsed_seconds{stage="gather-done"}` before lowering it.

### FM_WAITING_GATHER_TAKE_MS

How long an accept waits on a gather that is still running before it abandons
that gather and probes the device fresh over its own socket. The init-slot
reclaim signal ends the wait earlier. Default 60000 ms, the same as
`FM_WAITING_GATHER_MAX_MS`, so an accept never cuts short a gather that is
still inside its own budget.

## BLU Provenance Retention

### FM_BLU_PROVENANCE_RETENTION_DAYS

Every BLU reading a gateway relays also stores one provenance row: which
gateway and transport carried it, and its signal strength. The table grows with
every reading, so rows older than this many days are removed. Default 30.

One elected Fleet process removes them every 10 minutes, at most 40,000 rows
per run, in short batches. The readings themselves, the BLU device status and
energy history are not affected. Raise it only if you need to trace older
readings back to a gateway.

## Monitoring

All queue depths and drop counters are exposed in the observability output:

- **`/health`**: basic health check
- **`/health/debug-report`**: full system state including queue depths
- **`/metrics`**: Prometheus format

Key metrics to watch:

| Metric | What it means | Action if high |
|---|---|---|
| `statusQueue.pending` | Messages waiting to be processed | DB is slow: check flush times |
| `statusQueue.drops` | Messages dropped due to queue cap | Increase `FM_STATUS_QUEUE_MAX` or fix DB |
| `statusQueue.flushing` | `true` when DB write is in progress | Normal if brief; problem if sustained |
| `statusQueue.lastFlushMs` | Last DB flush duration in ms | Should be < `FM_STATUS_FLUSH_INTERVAL_MS` |
| `ws_max_buffered_kb` | Max WebSocket send buffer across all clients | Network congestion if >1MB |
| `device_inits_started` / `device_inits_completed` | Init throughput | Gap = init queue depth |
