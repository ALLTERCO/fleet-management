// Bottleneck / monitoring thresholds. Each is overridable via VITE_* env so
// deploys with different hardware profiles can tune without code changes.
// Naming: `<METRIC>_<TIER>` where tier is WARN (trigger) or CRITICAL (escalate).

import {readEnvNumber} from '@/helpers/env';

// Event loop lag (ms) — node's main thread blocking.
export const EVENT_LOOP_WARN_MS = readEnvNumber(
    'VITE_MON_EVENTLOOP_WARN_MS',
    50
);
export const EVENT_LOOP_CRITICAL_MS = readEnvNumber(
    'VITE_MON_EVENTLOOP_CRITICAL_MS',
    100
);

// Concurrent device-initialization fan-out.
export const INIT_ACTIVE_WARN = readEnvNumber('VITE_MON_INIT_ACTIVE_WARN', 50);
export const INIT_ACTIVE_CRITICAL = readEnvNumber(
    'VITE_MON_INIT_ACTIVE_CRITICAL',
    80
);

// Postgres pool — queued waiters before pool is saturated.
export const DB_POOL_WAITING_WARN = readEnvNumber(
    'VITE_MON_DB_POOL_WAITING_WARN',
    0
);
export const DB_POOL_WAITING_CRITICAL = readEnvNumber(
    'VITE_MON_DB_POOL_WAITING_CRITICAL',
    5
);

// DB query average latency (ms).
export const DB_AVG_WARN_MS = readEnvNumber('VITE_MON_DB_AVG_WARN_MS', 200);
export const DB_AVG_CRITICAL_MS = readEnvNumber(
    'VITE_MON_DB_AVG_CRITICAL_MS',
    500
);

// RPC average latency (ms).
export const RPC_AVG_WARN_MS = readEnvNumber('VITE_MON_RPC_AVG_WARN_MS', 500);
export const RPC_AVG_CRITICAL_MS = readEnvNumber(
    'VITE_MON_RPC_AVG_CRITICAL_MS',
    1000
);

// RPC error rate (%).
export const RPC_ERR_RATE_WARN_PCT = readEnvNumber(
    'VITE_MON_RPC_ERR_RATE_WARN_PCT',
    2
);
export const RPC_ERR_RATE_CRITICAL_PCT = readEnvNumber(
    'VITE_MON_RPC_ERR_RATE_CRITICAL_PCT',
    10
);

// Device-status flush queue size.
export const STATUS_QUEUE_WARN = readEnvNumber(
    'VITE_MON_STATUS_QUEUE_WARN',
    50
);
export const STATUS_QUEUE_CRITICAL = readEnvNumber(
    'VITE_MON_STATUS_QUEUE_CRITICAL',
    100
);

// Heap used (MB) — only flagged when trend is growing.
export const HEAP_WARN_MB = readEnvNumber('VITE_MON_HEAP_WARN_MB', 256);
export const HEAP_CRITICAL_MB = readEnvNumber('VITE_MON_HEAP_CRITICAL_MB', 512);

// EM sync queue sizes + active fan-out.
export const EM_ACTIVE_WARN = readEnvNumber('VITE_MON_EM_ACTIVE_WARN', 35);
export const EM_ACTIVE_CRITICAL = readEnvNumber(
    'VITE_MON_EM_ACTIVE_CRITICAL',
    38
);
export const EM_QUEUE_WARN = readEnvNumber('VITE_MON_EM_QUEUE_WARN', 50);
export const EM_QUEUE_CRITICAL = readEnvNumber(
    'VITE_MON_EM_QUEUE_CRITICAL',
    100
);

// node EventEmitter listener count — likely leak above 1k.
export const EVENT_LISTENERS_WARN = readEnvNumber(
    'VITE_MON_EVENT_LISTENERS_WARN',
    500
);
export const EVENT_LISTENERS_CRITICAL = readEnvNumber(
    'VITE_MON_EVENT_LISTENERS_CRITICAL',
    1000
);

// CPU user-time (%).
export const CPU_USER_WARN_PCT = readEnvNumber(
    'VITE_MON_CPU_USER_WARN_PCT',
    70
);
export const CPU_USER_CRITICAL_PCT = readEnvNumber(
    'VITE_MON_CPU_USER_CRITICAL_PCT',
    90
);

// OS free memory as % of total — host-size agnostic, matches the backend node.
// Flagged when LOW, so the comparison flips.
export const OS_FREE_MEM_WARN_PCT = readEnvNumber(
    'VITE_MON_OS_FREE_MEM_WARN_PCT',
    10
);
export const OS_FREE_MEM_CRITICAL_PCT = readEnvNumber(
    'VITE_MON_OS_FREE_MEM_CRITICAL_PCT',
    5
);

// GC max pause (ms).
export const GC_PAUSE_WARN_MS = readEnvNumber('VITE_MON_GC_PAUSE_WARN_MS', 100);
export const GC_PAUSE_CRITICAL_MS = readEnvNumber(
    'VITE_MON_GC_PAUSE_CRITICAL_MS',
    500
);

// Active libuv handles.
export const ACTIVE_HANDLES_WARN = readEnvNumber(
    'VITE_MON_ACTIVE_HANDLES_WARN',
    1000
);
export const ACTIVE_HANDLES_CRITICAL = readEnvNumber(
    'VITE_MON_ACTIVE_HANDLES_CRITICAL',
    5000
);

// Device initialization failure rate (%).
export const INIT_FAIL_RATE_WARN_PCT = readEnvNumber(
    'VITE_MON_INIT_FAIL_RATE_WARN_PCT',
    2
);

// Trend detection — how much the recent avg must exceed the older avg
// to count as "trending up".
export const TREND_UP_RATIO = readEnvNumber('VITE_MON_TREND_UP_RATIO', 1.5);

// Trend window — how many samples to look at for trend detection.
export const TREND_WINDOW_SAMPLES = readEnvNumber(
    'VITE_MON_TREND_WINDOW_SAMPLES',
    10
);
export const TREND_RECENT_HALF = readEnvNumber('VITE_MON_TREND_RECENT_HALF', 5);
