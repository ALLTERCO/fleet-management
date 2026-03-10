/**
 * Observability — tiered levels (0=OFF, 1=Light, 2=Medium, 3=Full)
 *
 * Toggle via:
 *   - Deploy env: FM_OBSERVABILITY=true  → level 2
 *   - Browser console: window.fmObservability(2)
 *   - localStorage: fm_obs_level = '0'..'3'
 *   - Legacy localStorage: fm_observability = '1' → level 2
 *   - UI toggle in Settings > Log
 */

export type ObsLevel = 0 | 1 | 2 | 3;
export const OBS_LEVEL_LABELS = ['OFF', 'Light', 'Medium', 'Full'] as const;
export const OBS_LEVEL_COLORS = ['neutral', 'blue', 'yellow', 'red'] as const;

export interface RpcTimingEntry {
    method: string;
    durationMs: number;
    ts: number;
}

export interface RpcErrorEntry {
    method: string;
    error: string;
    ts: number;
}

export interface InitFailureEntry {
    shellyID: string;
    error: string;
    ts: number;
}

const rtCfg = (window as any).__FM_RUNTIME_CONFIG__;

// --- Initialise level from persisted state ---
function initLevel(): ObsLevel {
    // Primary: fm_obs_level
    const stored = localStorage.getItem('fm_obs_level');
    if (stored !== null) {
        const parsed = parseInt(stored, 10);
        if (parsed >= 0 && parsed <= 3) return parsed as ObsLevel;
    }
    // Legacy: fm_observability = '1' → level 2
    if (localStorage.getItem('fm_observability') === '1') return 2;
    // Runtime config
    if (rtCfg?.observability === true) return 2;
    return 0;
}

let level: ObsLevel = initLevel();

const RING_SIZE = 200;
const rpcTimings: RpcTimingEntry[] = [];

// ── Public API — level ────────────────────────────────────────────────

export function getObsLevel(): ObsLevel {
    return level;
}

export function setObsLevel(l: ObsLevel) {
    level = l;
    localStorage.setItem('fm_obs_level', String(l));
    if (l === 0) {
        rpcTimings.length = 0;
    }
    updateWsRate();
    if (l >= 2) {
        startBatchSender();
    } else {
        stopBatchSender();
    }
}

/** Backward compat: returns true when any observability is on */
export function isObservabilityEnabled(): boolean {
    return level > 0;
}

/** Backward compat: bool toggle — maps false→0, true→2 */
export function setObservability(value: boolean) {
    setObsLevel(value ? 2 : 0);
}

// ── RPC timings (Tier 2+) ─────────────────────────────────────────────

export function recordRpcTiming(method: string, durationMs: number) {
    if (level < 2) return;
    if (rpcTimings.length >= RING_SIZE) rpcTimings.shift();
    rpcTimings.push({
        method,
        durationMs: Math.round(durationMs),
        ts: Date.now()
    });
}

export function getRpcTimings(): readonly RpcTimingEntry[] {
    return rpcTimings;
}

// ── WS message rate (Tier 3 only) ─────────────────────────────────────

let wsMessageCount = 0;
let wsMessagesPerSec = 0;
let wsRateInterval: ReturnType<typeof setInterval> | undefined;

export function recordWsMessage() {
    if (level < 3) return;
    wsMessageCount++;
}

export function getWsMessagesPerSec(): number {
    return wsMessagesPerSec;
}

function updateWsRate() {
    if (level >= 3 && !wsRateInterval) {
        wsRateInterval = setInterval(() => {
            wsMessagesPerSec = wsMessageCount;
            wsMessageCount = 0;
        }, 1000);
    } else if (level < 3 && wsRateInterval) {
        clearInterval(wsRateInterval);
        wsRateInterval = undefined;
        wsMessagesPerSec = 0;
        wsMessageCount = 0;
    }
}

// Kick off the interval if we initialised at level 3
updateWsRate();

// ── Pending RPC count (Tier 3 only) ───────────────────────────────────

let pendingRpcCount = 0;

export function setPendingRpcCount(count: number) {
    if (level < 3) return;
    pendingRpcCount = count;
}

export function getPendingRpcCount(): number {
    return pendingRpcCount;
}

// ── Counter rate-of-change tracking ───────────────────────────────────

let prevCounterSnapshot: Record<string, number> = {};
let prevCounterSnapshotTs = 0;
const counterRates: Record<string, number> = {}; // per-minute rates

export function computeCounterRates(currentCounters: Record<string, number>) {
    const now = Date.now();
    const elapsedMin = (now - prevCounterSnapshotTs) / 60000;
    if (prevCounterSnapshotTs > 0 && elapsedMin > 0) {
        for (const [key, val] of Object.entries(currentCounters)) {
            const prev = prevCounterSnapshot[key] ?? val;
            counterRates[key] = Math.round((val - prev) / elapsedMin);
        }
    }
    prevCounterSnapshot = {...currentCounters};
    prevCounterSnapshotTs = now;
}

export function getCounterRates(): Record<string, number> {
    return counterRates;
}

// ── Backend metrics cache ─────────────────────────────────────────────

let cachedMetrics: any = null;

export async function fetchBackendMetrics(): Promise<any> {
    try {
        const res = await fetch('/health');
        const data = await res.json();
        cachedMetrics = data.metrics ?? null;
        // Compute counter rates when counters are available
        if (cachedMetrics?.counters) {
            computeCounterRates(cachedMetrics.counters);
        }
        return cachedMetrics;
    } catch {
        cachedMetrics = null;
        return null;
    }
}

export function getCachedBackendMetrics() {
    return cachedMetrics;
}

// ── Debug report ──────────────────────────────────────────────────────

export async function fetchDebugReport(): Promise<any> {
    try {
        const res = await fetch('/health/debug-report');
        return await res.json();
    } catch {
        return null;
    }
}

// ── Interaction event tracking (Tier 2+) ─────────────────────────────

export interface InteractionEvent {
    category: string;
    action: string;
    label?: string;
    ts: number;
}

export interface ClickEvent {
    x: number;
    y: number;
    target: string;
    page: string;
    timestamp: number;
}

const INTERACTION_RING_SIZE = 500;
const CLICK_RING_SIZE = 200;
const BATCH_INTERVAL_MS = 30_000;
const interactions: InteractionEvent[] = [];
const interactionCounts: Record<string, number> = {};
const clickEvents: ClickEvent[] = [];

export function trackInteraction(
    category: string,
    action: string,
    label?: string
) {
    if (level < 2) return;
    if (interactions.length >= INTERACTION_RING_SIZE) interactions.shift();
    interactions.push({category, action, label, ts: Date.now()});

    const key = `${category}.${action}`;
    interactionCounts[key] = (interactionCounts[key] || 0) + 1;
}

export function trackClick(event: MouseEvent, page: string) {
    if (level < 2) return;
    const el = event.target as HTMLElement | null;
    const selector = el
        ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`
        : 'unknown';
    if (clickEvents.length >= CLICK_RING_SIZE) clickEvents.shift();
    clickEvents.push({
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
        target: selector,
        page,
        timestamp: Date.now()
    });
}

export function getClickEvents(): readonly ClickEvent[] {
    return clickEvents;
}

export function getInteractions(): readonly InteractionEvent[] {
    return interactions;
}

export function getInteractionCounts(): Readonly<Record<string, number>> {
    return interactionCounts;
}

// ── Batch sender — flushes interaction counts to backend (Tier 2+) ───

let batchInterval: ReturnType<typeof setInterval> | undefined;

function flushTelemetryBatch() {
    if (level < 2) return;
    const counts = {...interactionCounts};
    if (Object.keys(counts).length === 0) return;
    // Fire-and-forget POST; backend can expose these as Prometheus counters
    fetch('/api/telemetry/events', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({counts, clicks: clickEvents.length})
    }).catch(() => {
        /* silent — telemetry is best-effort */
    });
}

function startBatchSender() {
    if (batchInterval) return;
    batchInterval = setInterval(flushTelemetryBatch, BATCH_INTERVAL_MS);
}

function stopBatchSender() {
    if (batchInterval) {
        clearInterval(batchInterval);
        batchInterval = undefined;
    }
}

// ── Boot: start batch sender if level warrants it ─────────────────────
if (level >= 2) startBatchSender();

// ── Expose toggle on window for console access ────────────────────────
(window as any).fmObservability = setObsLevel;
