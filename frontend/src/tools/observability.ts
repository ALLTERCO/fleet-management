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

import {sendRPC} from './websocket';

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

const rtCfg = window.__FM_RUNTIME_CONFIG__;

// Default is Light (1) so the monitoring surface is alive OOTB.
// User can downgrade to 0 (OFF) explicitly via the tier toggle.
function initLevel(): ObsLevel {
    const stored = localStorage.getItem('fm_obs_level');
    if (stored !== null) {
        const parsed = Number.parseInt(stored, 10);
        if (parsed >= 0 && parsed <= 3) return parsed as ObsLevel;
    }
    if (localStorage.getItem('fm_observability') === '1') return 2;
    if (rtCfg?.observability === true) return 2;
    return 1;
}

let level: ObsLevel = initLevel();

const RING_SIZE = 200;
const rpcTimings: (RpcTimingEntry | undefined)[] = new Array(RING_SIZE);
let rpcTimingsIdx = 0;
let rpcTimingsCount = 0;

// ── Public API — level ────────────────────────────────────────────────

export function getObsLevel(): ObsLevel {
    return level;
}

export function setObsLevel(l: ObsLevel) {
    level = l;
    localStorage.setItem('fm_obs_level', String(l));
    if (l === 0) {
        rpcTimings.fill(undefined);
        rpcTimingsIdx = 0;
        rpcTimingsCount = 0;
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
    rpcTimings[rpcTimingsIdx % RING_SIZE] = {
        method,
        durationMs: Math.round(durationMs),
        ts: Date.now()
    };
    rpcTimingsIdx++;
    if (rpcTimingsCount < RING_SIZE) rpcTimingsCount++;
}

export function getRpcTimings(): readonly RpcTimingEntry[] {
    if (rpcTimingsCount === 0) return [];
    if (rpcTimingsCount < RING_SIZE) {
        return rpcTimings.slice(0, rpcTimingsCount) as RpcTimingEntry[];
    }
    // Return in chronological order: oldest first
    const start = rpcTimingsIdx % RING_SIZE;
    return [
        ...rpcTimings.slice(start),
        ...rpcTimings.slice(0, start)
    ] as RpcTimingEntry[];
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
        const data = await sendRPC(
            'FLEET_MANAGER',
            'System.Health.GetFull',
            {}
        );
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
        return await sendRPC(
            'FLEET_MANAGER',
            'System.Health.GetDebugReport',
            {}
        );
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
const interactions: (InteractionEvent | undefined)[] = new Array(
    INTERACTION_RING_SIZE
);
let interactionsIdx = 0;
let interactionsCount = 0;
const interactionCounts: Record<string, number> = {};
const clickEvents: (ClickEvent | undefined)[] = new Array(CLICK_RING_SIZE);
let clickEventsIdx = 0;
let clickEventsCount = 0;

export function trackInteraction(
    category: string,
    action: string,
    label?: string
) {
    if (level < 2) return;
    interactions[interactionsIdx % INTERACTION_RING_SIZE] = {
        category,
        action,
        label,
        ts: Date.now()
    };
    interactionsIdx++;
    if (interactionsCount < INTERACTION_RING_SIZE) interactionsCount++;

    const key = `${category}.${action}`;
    interactionCounts[key] = (interactionCounts[key] || 0) + 1;
}

export function trackClick(event: MouseEvent, page: string) {
    if (level < 2) return;
    const el = event.target as HTMLElement | null;
    const selector = el
        ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`
        : 'unknown';
    clickEvents[clickEventsIdx % CLICK_RING_SIZE] = {
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
        target: selector,
        page,
        timestamp: Date.now()
    };
    clickEventsIdx++;
    if (clickEventsCount < CLICK_RING_SIZE) clickEventsCount++;
}

export function getClickEvents(): readonly ClickEvent[] {
    if (clickEventsCount === 0) return [];
    if (clickEventsCount < CLICK_RING_SIZE) {
        return clickEvents.slice(0, clickEventsCount) as ClickEvent[];
    }
    const start = clickEventsIdx % CLICK_RING_SIZE;
    return [
        ...clickEvents.slice(start),
        ...clickEvents.slice(0, start)
    ] as ClickEvent[];
}

export function getInteractions(): readonly InteractionEvent[] {
    if (interactionsCount === 0) return [];
    if (interactionsCount < INTERACTION_RING_SIZE) {
        return interactions.slice(0, interactionsCount) as InteractionEvent[];
    }
    const start = interactionsIdx % INTERACTION_RING_SIZE;
    return [
        ...interactions.slice(start),
        ...interactions.slice(0, start)
    ] as InteractionEvent[];
}

export function getInteractionCounts(): Readonly<Record<string, number>> {
    return interactionCounts;
}

// ── Batch sender — flushes interaction counts to backend (Tier 2+) ───

let batchInterval: ReturnType<typeof setInterval> | undefined;

function flushTelemetryBatch() {
    // Batch runs when either obs level ≥ 2 (interaction counts) OR
    // the WS telemetry opt-in is on (perf-attack snapshot).
    if (level < 2 && !wsTelemetryEnabled) return;
    const counts = {...interactionCounts};
    const ws = wsTelemetryEnabled ? getWsTelemetry() : null;
    const hasWs = !!(
        ws &&
        (ws.patchBufferMaxDepth > 0 ||
            ws.droppedFrameCount > 0 ||
            ws.rafFrameTimeMaxMs > 0)
    );
    if (Object.keys(counts).length === 0 && clickEventsCount === 0 && !hasWs) {
        return;
    }
    // Fire-and-forget RPC; backend maps keys into Prometheus counters
    // under the `ui_*` prefix via SystemComponent.
    sendRPC('FLEET_MANAGER', 'System.SubmitTelemetry', {
        counts,
        clicks: clickEventsCount,
        ...(hasWs ? {wsTelemetry: ws} : {})
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

// ── Boot: start batch sender if level warrants it or WS telemetry on ──
// wsTelemetryEnabled hasn't been read here yet — it's declared a few
// blocks down. Read localStorage directly so boot order doesn't matter.
if (level >= 2 || localStorage.getItem('fm_ws_telemetry') === '1') {
    startBatchSender();
}

// ── Heatmap overlay (opt-in toggle, requires obs level ≥ 2) ──────────

let heatmapEnabled = localStorage.getItem('fm_heatmap') === '1';
// Subscribers notified on toggle change
const heatmapListeners: Array<(v: boolean) => void> = [];

export function isHeatmapEnabled(): boolean {
    return heatmapEnabled && level >= 2;
}

export function setHeatmap(v: boolean) {
    heatmapEnabled = v;
    localStorage.setItem('fm_heatmap', v ? '1' : '0');
    const active = isHeatmapEnabled();
    for (const fn of heatmapListeners) fn(active);
}

export function onHeatmapChange(fn: (v: boolean) => void): () => void {
    heatmapListeners.push(fn);
    return () => {
        const idx = heatmapListeners.indexOf(fn);
        if (idx >= 0) heatmapListeners.splice(idx, 1);
    };
}

// ── WS Patch Telemetry (opt-in toggle, independent of obs level) ──────

let wsTelemetryEnabled = localStorage.getItem('fm_ws_telemetry') === '1';

export function isWsTelemetryEnabled(): boolean {
    return wsTelemetryEnabled;
}

export function setWsTelemetry(v: boolean) {
    wsTelemetryEnabled = v;
    localStorage.setItem('fm_ws_telemetry', v ? '1' : '0');
    if (!v) resetWsTelemetry();
    // Without this, enabling WS telemetry below obs level 2 would collect
    // numbers locally but never push them to backend Prometheus.
    if (v) startBatchSender();
}

// B1: peak pendingPatches size between RAF flushes
let patchBufferMaxDepth = 0;
// B2: count of frames where chunk limit kicked in (deferred patches)
let droppedFrameCount = 0;
// B3: max applyPatchBatch() duration per frame (ms)
let rafFrameTimeMaxMs = 0;
// Cumulative: compare to backend `shelly_*_emitted` counters to detect lost events.
let shellyConnectReceived = 0;
let shellyDisconnectReceived = 0;

// End-to-end latency reservoirs (ms): backend emit timestamp → frontend patch apply.
// Fixed-capacity ring buffer — O(1) push, no array shifts under disconnect storms.
const RESERVOIR_SIZE = 200;

interface Reservoir {
    buf: Float64Array;
    next: number;
    filled: number;
}

function newReservoir(): Reservoir {
    return {buf: new Float64Array(RESERVOIR_SIZE), next: 0, filled: 0};
}

const connectLatency = newReservoir();
const disconnectLatency = newReservoir();

function pushReservoir(r: Reservoir, value: number) {
    r.buf[r.next] = value;
    r.next = (r.next + 1) % RESERVOIR_SIZE;
    if (r.filled < RESERVOIR_SIZE) r.filled++;
}

function clearReservoir(r: Reservoir) {
    r.next = 0;
    r.filled = 0;
}

// Nearest-rank percentile (ceil(p*n)-1).
function quantile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(p * sorted.length) - 1)
    );
    return sorted[idx];
}

function summarize(r: Reservoir) {
    if (r.filled === 0) {
        return {count: 0, last: 0, max: 0, p50: 0, p95: 0};
    }
    const samples = Array.from(r.buf.subarray(0, r.filled));
    const sorted = [...samples].sort((a, b) => a - b);
    const lastIdx = (r.next + RESERVOIR_SIZE - 1) % RESERVOIR_SIZE;
    return {
        count: r.filled,
        last: r.buf[lastIdx],
        max: sorted[sorted.length - 1],
        p50: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95)
    };
}

export function recordPatchBufferDepth(size: number) {
    if (!wsTelemetryEnabled) return;
    if (size > patchBufferMaxDepth) patchBufferMaxDepth = size;
}

export function recordDroppedFrame() {
    if (!wsTelemetryEnabled) return;
    droppedFrameCount++;
}

export function recordRafFrameTime(ms: number) {
    if (!wsTelemetryEnabled) return;
    if (ms > rafFrameTimeMaxMs) rafFrameTimeMaxMs = ms;
}

export function recordShellyConnectReceived() {
    if (!wsTelemetryEnabled) return;
    shellyConnectReceived++;
}

export function recordShellyDisconnectReceived() {
    if (!wsTelemetryEnabled) return;
    shellyDisconnectReceived++;
}

export function recordShellyConnectLatency(ms: number) {
    if (!wsTelemetryEnabled) return;
    if (ms < 0 || ms > 600_000) return; // skip clock-skew or stale samples
    pushReservoir(connectLatency, ms);
}

export function recordShellyDisconnectLatency(ms: number) {
    if (!wsTelemetryEnabled) return;
    if (ms < 0 || ms > 600_000) return;
    pushReservoir(disconnectLatency, ms);
}

/** Snapshot-then-reset (same pattern as backend broadcastMaxMs) */
export function getWsTelemetry() {
    const snapshot = {
        patchBufferMaxDepth,
        droppedFrameCount,
        rafFrameTimeMaxMs: Math.round(rafFrameTimeMaxMs * 100) / 100,
        shellyConnectReceived,
        shellyDisconnectReceived,
        shellyConnectLatencyMs: summarize(connectLatency),
        shellyDisconnectLatencyMs: summarize(disconnectLatency)
    };
    patchBufferMaxDepth = 0;
    rafFrameTimeMaxMs = 0;
    // droppedFrameCount + shelly*Received are cumulative — don't reset
    // Latency reservoirs roll on their own via bounded push; don't reset either.
    return snapshot;
}

function resetWsTelemetry() {
    patchBufferMaxDepth = 0;
    droppedFrameCount = 0;
    rafFrameTimeMaxMs = 0;
    shellyConnectReceived = 0;
    shellyDisconnectReceived = 0;
    clearReservoir(connectLatency);
    clearReservoir(disconnectLatency);
}

// ── Expose toggle on window for console access ────────────────────────
window.fmObservability = setObsLevel;
