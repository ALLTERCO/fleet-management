import * as log4js from 'log4js';
import {tuning} from '../config';
import {envInt} from '../config/envReader';
import type ShellyDevice from '../model/ShellyDevice';
import * as DeviceCollector from '../modules/DeviceCollector';
import type {ShellyMessageIncoming} from '../types';
import {
    buildEmStatsBatch,
    type EmDataBlock,
    hasStoredFields,
    type MeasurementField,
    measurementFields,
    parseEmSyncPeriod
} from './device/emRecordRows';
import type {
    EmSyncBlock,
    EmSyncCursor,
    EmSyncGap
} from './device/emSyncCoalescer';
import {
    type EmSyncPageRelease,
    type EmSyncPageWait,
    getEmSyncPullAdmission
} from './device/emSyncPullAdmission';
import {writeEmSyncPullPage} from './device/emSyncPullWriter';
import type {EmSyncRecordPush} from './device/emSyncRecordEntry';
import {
    armEmSync,
    type EmSyncCandidate,
    type EmSyncChannelOutcome,
    type EmSyncLane,
    emSyncJitterSeconds,
    emSyncLiveCadenceMaxSeconds,
    pickDueEmSyncDevices,
    resolveDeviceOutcome
} from './device/emSyncScheduler';
import {
    type EmSyncPullPauseReason,
    emSyncPullPauseReason,
    enqueueEmSyncRecords,
    readEmSyncBufferPressure
} from './device/emSyncStream';
import * as Observability from './Observability';
import {recordEmSyncPushDelay} from './observability/emSyncPushMetrics';
import {
    callMethod,
    getQueryPoolPressure,
    type PoolPressure
} from './PostgresProvider';
import {fireAndForget} from './util/fireAndForget';
import {StuckMonitor} from './util/inFlightStuck';
import {runBoundedParallel} from './util/runBoundedParallel';
import {StageTimer} from './util/stageTimer';

type SyncProfile = {
    method: string;
    channels: number[];
    phases?: string[];
};

const BOOT_SEED_CONCURRENCY = 8;
const BOOT_SEED_TASK_TIMEOUT_MS = 10_000;
const logger = log4js.getLogger('message-parser');

// Epoch of the first record not returned by a GetData batch. Shelly defines
// the request `ts` as the first record to return, so resuming at the last
// committed record would fetch that record twice.
function nextUnconsumedRecordTs(data: EmDataBlock[]): number | undefined {
    let next: number | undefined;
    for (const block of data) {
        if (!Array.isArray(block.values) || block.values.length === 0) continue;
        const blockNext =
            block.ts + parseEmSyncPeriod(block.period) * block.values.length;
        if (next === undefined || blockNext > next) next = blockNext;
    }
    return next;
}

// Prefer the device's next_record_ts; when absent, resume from the first record
// after the committed batch, else hold the prior cursor.
export function nextEmSyncCursor(input: {
    nextTs: number | undefined;
    data: EmDataBlock[];
    lastSyncTs: number;
}): number {
    if (typeof input.nextTs === 'number' && input.nextTs > 0) {
        return input.nextTs;
    }
    return nextUnconsumedRecordTs(input.data) ?? input.lastSyncTs;
}

/**
 * Auto-detect EM sync profile from device status keys.
 * No hardcoded model list — works for any device with em1:N or em:N components.
 */
function detectSyncProfile(device: ShellyDevice): SyncProfile | null {
    const status = device.status;
    if (!status) return null;

    // Check for em1:N keys (monophase / single-channel EM)
    const em1Channels: number[] = [];
    for (const key of Object.keys(status)) {
        if (key.startsWith('em1:')) {
            const id = Number.parseInt(key.split(':')[1], 10);
            if (!Number.isNaN(id)) em1Channels.push(id);
        }
    }
    if (em1Channels.length > 0) {
        return {
            method: 'em1data.getdata',
            channels: em1Channels.sort((a, b) => a - b)
        };
    }

    // Check for em:N keys (triphase EM)
    const emChannels: number[] = [];
    for (const key of Object.keys(status)) {
        if (key.startsWith('em:')) {
            const id = Number.parseInt(key.split(':')[1], 10);
            if (!Number.isNaN(id)) emChannels.push(id);
        }
    }
    if (emChannels.length > 0) {
        return {
            method: 'emdata.getdata',
            channels: emChannels.sort((a, b) => a - b),
            phases: ['a', 'b', 'c']
        };
    }

    return null;
}

const day0 = (before = 90) => {
    const past = new Date();
    const now = new Date();
    const d = new Date(past.setDate(now.getDate() - before));
    return (
        new Date(
            Date.UTC(
                d.getUTCFullYear(),
                d.getUTCMonth(),
                d.getUTCDate(),
                0,
                0,
                0
            )
        ).getTime() / 1000
    );
};

/**
 * EM Sync scaling limits (monolith, in-memory, single postgres):
 *
 * Each sync does ~3-4 DB queries + 1 device RPC (~100-200ms total).
 * At MAX_CONCURRENT_SYNCS=40, throughput is ~200-400 syncs/sec.
 *
 * Strict 10-minute window: base 9min + up to 60s jitter = max 10min.
 * Devices needing sync per tick = total_devices / (9min * 60s + avg_jitter).
 *
 *   700 devices  → ~1.3 due/sec  → 40 concurrent handles easily
 *   5k devices   → ~9 due/sec    → 40 concurrent handles easily
 *   20k devices  → ~37 due/sec   → 40 concurrent handles it
 *   50k devices  → ~93 due/sec   → may need MAX_CONCURRENT_SYNCS=60-80
 *   160k+ devices → requires Redis + microservices (multiple workers)
 */
// All timing knobs in ms (JS native unit). Internal seconds derived where needed.
const SYNC_THRESHOLD_MS = envInt('FM_EMDATA_SYNC_THRESHOLD_MS', 9 * 60 * 1000);
const SYNC_THRESHOLD_S = Math.floor(SYNC_THRESHOLD_MS / 1000);
const LIVE_CADENCE_MAX_S = emSyncLiveCadenceMaxSeconds(SYNC_THRESHOLD_S);
const EM_SYNC_GRACE_PERIOD_MS = envInt(
    'FM_EMDATA_GRACE_PERIOD_MS',
    5 * 60 * 1000
);
let MAX_CONCURRENT_SYNCS = 40;
let MAX_CONCURRENT_CHANNELS = 120;
let RESERVED_CATCHUP_SLOTS = 10;
let emTuningInitialized = false;
const TICK_INTERVAL_MS = envInt('FM_EMDATA_TICK_INTERVAL_MS', 1000);
// The oldest a due device may sit un-dispatched before the sync loop is
// declared to be falling behind. Default 4x the gentle cadence: past this, a
// device is waiting several full cadences for a slot, which means selection —
// or throughput — cannot keep up. Flips the em_sync_starvation_suspected flag
// for observability; there is no Grafana rule, ops reads the gauge / health.
const STARVATION_ALERT_S = envInt(
    'FM_EMDATA_STARVATION_ALERT_S',
    4 * SYNC_THRESHOLD_S
);
const EM_SYNC_FUTURE_TOLERANCE_S = 5 * 60;
// A channel sync pass slower than this logs a one-line stage breakdown
// (last_sync vs drain) so the slow part of a pass is visible per device.
const EMSYNC_PASS_SLOW_MS = envInt('FM_EMDATA_PASS_SLOW_MS', 5000);
// Pushes keep a channel current; a pull runs only once complete-up-to is
// older than this (a push was missed), after a reconnect, or for a new channel.
const PULL_GRACE_S = Math.floor(
    envInt('FM_EMDATA_PULL_GRACE_MS', 120_000) / 1000
);
// A device clock earlier than 2020-01-01 was never set.
const EM_RECORD_TS_FLOOR_S = 1_577_836_800;
const EM_RECORD_KEY_CACHE_MAX = 20_000;
const RECORD_COMPONENT_METHODS: Readonly<Record<string, string>> = {
    emdata: 'emdata.getdata',
    em1data: 'em1data.getdata'
};

export function isEmPullDue(input: {
    cursor: number;
    nowS: number;
    graceS: number;
    forced: boolean;
}): boolean {
    return input.forced || input.nowS - input.cursor > input.graceS;
}

function recordBlockEnd(block: EmDataBlock): number | null {
    const period = Number(block.period);
    if (!Number.isInteger(period) || period <= 0) return null;
    if (!Array.isArray(block.values) || !Number.isSafeInteger(block.ts)) {
        return null;
    }
    return block.ts + period * block.values.length;
}

// Blocks whose clock is unset (before the floor) or ahead of ours are not
// stored: their minutes cannot be placed.
export function usableRecordBlocks(input: {
    data: EmDataBlock[];
    nowS: number;
}): {usable: EmDataBlock[]; rejected: number} {
    const usable = input.data.filter((block) => {
        const end = recordBlockEnd(block);
        return (
            end !== null &&
            block.ts >= EM_RECORD_TS_FLOOR_S &&
            isEmSyncCursorPlausible(end, input.nowS)
        );
    });
    return {usable, rejected: input.data.length - usable.length};
}

function isRecordBlockArray(data: unknown): data is EmDataBlock[] {
    return (
        Array.isArray(data) &&
        data.every(
            (block) =>
                typeof block === 'object' &&
                block !== null &&
                typeof (block as EmDataBlock).ts === 'number' &&
                Array.isArray((block as EmDataBlock).values)
        )
    );
}

// How far a pull answer speaks for the device. GetData returns every record
// up to end_ts unless it chunks (next_record_ts before end_ts), so an answer
// without a chunk pointer covers the whole requested hole.
export function pullClaimEnd(input: {
    nextDate: number;
    nextTs: number | undefined;
    endTs: number | undefined;
}): number {
    if (input.endTs === undefined) return input.nextDate;
    const chunked =
        typeof input.nextTs === 'number' &&
        input.nextTs > 0 &&
        input.nextTs < input.endTs;
    return chunked ? Math.min(input.nextDate, input.endTs) : input.endTs;
}

function recordComponentOf(method: string, channel: number): string {
    return `${method.split('.')[0]}:${channel}`;
}

// Key order is the device's, per firmware; never guessed.
class EmRecordKeyCache {
    readonly #keys = new Map<string, string[]>();

    get(key: string): string[] | undefined {
        return this.#keys.get(key);
    }

    set(key: string, keys: string[]): void {
        this.#keys.delete(key);
        this.#keys.set(key, keys);
        if (this.#keys.size <= EM_RECORD_KEY_CACHE_MAX) return;
        const oldest = this.#keys.keys().next().value;
        if (oldest !== undefined) this.#keys.delete(oldest);
    }
}

function recordKeyCacheKey(device: ShellyDevice, component: string): string {
    const info = (device.info ?? {}) as {fw_id?: unknown; ver?: unknown};
    return `${device.shellyID}|${String(info.fw_id ?? info.ver ?? '')}|${component}`;
}

function recordCount(blocks: readonly EmDataBlock[]): number {
    return blocks.reduce((sum, block) => sum + block.values.length, 0);
}

export function isEmSyncCursorPlausible(cursor: number, nowS: number): boolean {
    return (
        Number.isFinite(cursor) && cursor <= nowS + EM_SYNC_FUTURE_TOLERANCE_S
    );
}

export interface EmSyncChannelLag {
    deviceId: string;
    channel: number;
    lagSeconds: number;
}

export function emSyncAcceptedLagSeconds(input: {
    previousLagSeconds: number;
    cursor: number;
    nowS: number;
}): number {
    if (!isEmSyncCursorPlausible(input.cursor, input.nowS)) {
        return input.previousLagSeconds;
    }
    return Math.max(0, Math.floor(input.nowS) - input.cursor);
}

export function emSyncLagSnapshot(input: {
    entries: Iterable<EmSyncChannelLag>;
    caughtUpSlackSeconds: number;
}): {
    worst: EmSyncChannelLag;
    laggedChannels: number;
    channelsBeyondCaughtUpSlack: number;
} {
    let worst = {deviceId: '', channel: -1, lagSeconds: 0};
    let laggedChannels = 0;
    let channelsBeyondCaughtUpSlack = 0;
    for (const entry of input.entries) {
        if (entry.lagSeconds > 0) laggedChannels++;
        if (entry.lagSeconds > input.caughtUpSlackSeconds) {
            channelsBeyondCaughtUpSlack++;
        }
        if (entry.lagSeconds > worst.lagSeconds) worst = entry;
    }
    return {worst, laggedChannels, channelsBeyondCaughtUpSlack};
}

// ── EM-sync catch-up ─────────────────────────────────────────────────────────
// A single emdata.getdata block covers only a few minutes of device history, so
// one block per ~9-min cadence can't keep up — long-running tenants drift months
// behind (the bookmark lags far past now). Catch-up drains a device's backlog
// within ONE sync pass by looping emdata.getdata (following next_record_ts)
// until the device is current — while staying a strictly LOWER priority than
// live ingestion.
//
// Bounded three ways so a slot is never monopolised and the shared DB is never
// starved:
//   * CATCHUP_MAX_ITERS  — max emdata blocks pulled per device per pass.
//   * CATCHUP_MAX_MS     — wall-time budget per pass (slot-hold cap).
//   * pool back-off      — between blocks, if anything is queued for a DB
//                          connection (waitingCount>0) or the pool is hot, stop
//                          draining and yield; the device resumes next cadence.
// The FIRST block always runs (== legacy one-block-per-cadence baseline, which
// the system already sustains); only the EXTRA catch-up blocks are gated. Each
// block persists its bookmark (fn_synced) so a pass is fully resumable.
//
// Multi-block catch-up keeps reports current by draining a backlogged device
// within one pass; it is ON for every device and made safe by the back-off
// below (it yields the moment live work or reports need the DB). The optional
// allowlist FM_EMDATA_CATCHUP_DEVICE_IDS scopes it to specific devices for a
// staged rollout; empty means all devices.
const CATCHUP_MAX_ITERS = envInt('FM_EMDATA_CATCHUP_MAX_ITERS', 100);
const CATCHUP_MAX_MS = envInt('FM_EMDATA_CATCHUP_MAX_MS', 60_000);
const CATCHUP_CAUGHTUP_SLACK_S = SYNC_THRESHOLD_S;
const CATCHUP_POOL_USAGE_PAUSE =
    envInt('FM_EMDATA_CATCHUP_POOL_USAGE_PAUSE_PCT', 70) / 100;
const CATCHUP_INTER_BATCH_MS = envInt('FM_EMDATA_CATCHUP_INTER_BATCH_MS', 0);
// Cadence is armed from the OUTCOME of each pass (see emSyncScheduler), not
// from how stale the device's data looks. Lag froze permanently on several
// paths — a zero-day seed, a channel with no cursor row, one failing channel —
// which pinned those devices at the fast cadence for good and let them hold
// every slot. What the device actually returned cannot freeze.
const CATCHUP_DEVICE_IDS: ReadonlySet<number> = new Set(
    tuning.energy.catchupDeviceIds
);

// Whether a device runs multi-block catch-up this pass. An empty allowlist
// means all devices (the default); a non-empty allowlist scopes a staged
// rollout to just those devices.
export function isCatchupAllowed(input: {
    allowed: ReadonlySet<number>;
    deviceId: number;
}): boolean {
    return input.allowed.size === 0 || input.allowed.has(input.deviceId);
}

export interface EmSyncPassDecision {
    stop: boolean; // stop the catch-up pass after this block
    bufferedOk: boolean; // advance the in-memory bookmark for this block?
    nextCursor: number; // cursor for the next iteration
}

// Gap-safety: a block that didn't buffer stops the pass and never advances the
// bookmark, so the drainer can't move it past an undelivered block. Otherwise
// stop on the normal terminations (no more history, no progress, caught up).
export function emSyncPassDecision(input: {
    buffered: boolean;
    nextDate: number;
    cursor: number;
    nextTs: number | undefined;
    nowS: number;
    caughtUpSlackS: number;
}): EmSyncPassDecision {
    if (!input.buffered) {
        return {stop: true, bufferedOk: false, nextCursor: input.cursor};
    }
    if (!input.nextTs || input.nextDate <= input.cursor) {
        return {stop: true, bufferedOk: true, nextCursor: input.cursor};
    }
    if (input.nextDate >= input.nowS - input.caughtUpSlackS) {
        return {stop: true, bufferedOk: true, nextCursor: input.nextDate};
    }
    return {stop: false, bufferedOk: true, nextCursor: input.nextDate};
}

const catchupAllowed = (deviceId: number): boolean =>
    isCatchupAllowed({allowed: CATCHUP_DEVICE_IDS, deviceId});

export function seedMissingEmSyncCursors(input: {
    cursors: Map<number, number>;
    channels: readonly number[];
    seededAt: number;
}): number[] {
    const missing = input.channels.filter(
        (channel) => !input.cursors.has(channel)
    );
    for (const channel of missing) input.cursors.set(channel, input.seededAt);
    return missing;
}

// Time each stored energy record covers, sorted, one span per record.
function energyRecordSpans(rows: EmSyncBlock['rows']): EmSyncGap[] {
    const spans = new Map<number, number>();
    rows.p_tag.forEach((tag, i) => {
        const period = rows.p_period?.[i];
        if (tag !== 'total_act_energy' || typeof period !== 'number') return;
        spans.set(rows.p_ts[i], rows.p_ts[i] + period);
    });
    return [...spans]
        .map(([from, to]) => ({from, to}))
        .sort((a, b) => a.from - b.from);
}

// Inside what a pull claims, every stretch without a stored energy record is a
// range the device has no usable record for. Recorded once, never re-pulled.
export function deviceGapsInPull(input: {
    requestedTs: number;
    claimedUntil: number;
    rows: EmSyncBlock['rows'];
}): EmSyncGap[] {
    const gaps: EmSyncGap[] = [];
    let at = input.requestedTs;
    for (const span of energyRecordSpans(input.rows)) {
        if (span.from >= input.claimedUntil) break;
        if (span.from > at) gaps.push({from: at, to: span.from});
        at = Math.max(at, span.to);
    }
    if (at < input.claimedUntil) {
        gaps.push({from: at, to: input.claimedUntil});
    }
    return gaps;
}

export interface EmSyncRpcBlock {
    keys: string[];
    data: EmDataBlock[];
    nextTs: number | undefined;
}

// A GetData answer together with the ts it was asked for.
export interface EmSyncFetchedBlock extends EmSyncRpcBlock {
    requestedTs: number;
}

export interface EmSyncPassDeps {
    startCursor: number;
    // Gap fill: stop once the pass reaches this already stored record.
    endTs?: number;
    maxIters: number;
    deadlineMs: number;
    now: () => number;
    fetchBlock: (cursor: number) => Promise<EmSyncRpcBlock | null>;
    // Writes the page to the database; true once it is committed.
    storeBlock: (
        nextDate: number,
        block: EmSyncFetchedBlock
    ) => Promise<boolean>;
    poolPressure: () => {waitingCount: number; usage: number};
    pausePct: number;
    // Why the push buffer needs the database now, or null.
    bufferPause?: () => EmSyncPullPauseReason | null;
    caughtUpSlackS: number;
    interBatchMs: number;
    // Hard slot reclaim. `deadlineMs` is only checked between blocks, so the
    // last in-flight RPC can hold a concurrency slot for a full rpcTimeoutMs
    // past it; aborting the RPC is what makes the hold time actually bounded.
    signal?: AbortSignal;
    // Waits until the database can take one more page; null when the pass
    // gave up first. Without it every page is fetched at once.
    reservePage?: (cursor: number) => Promise<EmSyncPageRelease | null>;
    onYield?: (reason: EmSyncPullYieldReason) => void;
    onInvalid?: () => void;
    onAcceptedCursor?: (cursor: number) => void;
}

export type EmSyncPullYieldReason = 'pool' | EmSyncPullPauseReason;

// Between pages a pass gives way to waiting database work and to the push
// buffer; the first page always runs.
function pullYieldReason(deps: EmSyncPassDeps): EmSyncPullYieldReason | null {
    const p = deps.poolPressure();
    if (p.waitingCount > 0 || p.usage > deps.pausePct) return 'pool';
    return deps.bufferPause?.() ?? null;
}

export interface EmSyncPassResult {
    lastGood: number | undefined;
    iters: number;
    // The pass ended waiting for database room, not because it was done.
    deferred: boolean;
}

function noRelease(): void {}

// One catch-up pass: pull blocks, store them, advance in order. A page is
// fetched only once the database has room for it, and the next only after
// it is stored. The I/O (RPC, database write, pool pressure) is injected so
// the orchestration is testable.
export async function runEmSyncPass(
    deps: EmSyncPassDeps
): Promise<EmSyncPassResult> {
    let cursor = deps.startCursor;
    let lastGood: number | undefined;
    let iters = 0;
    while (
        iters < deps.maxIters &&
        deps.now() < deps.deadlineMs &&
        !deps.signal?.aborted
    ) {
        if (yieldBeforePage(deps, iters)) break;
        const release = deps.reservePage
            ? await deps.reservePage(cursor)
            : noRelease;
        if (release === null) return {lastGood, iters, deferred: true};
        // The wait for room can be long; give way if things changed in it.
        if (yieldBeforePage(deps, iters)) {
            release();
            break;
        }
        let page: PulledPage | null;
        try {
            iters++;
            page = await pullAndStore(deps, cursor);
        } finally {
            release();
        }
        if (page === null) break;
        const {step} = page;
        if (step.bufferedOk) lastGood = page.nextDate;
        cursor = step.nextCursor;
        if (step.stop) break;
        if (deps.endTs !== undefined && cursor >= deps.endTs) break;
        if (deps.interBatchMs > 0) {
            await new Promise((r) => setTimeout(r, deps.interBatchMs));
        }
    }
    return {lastGood, iters, deferred: false};
}

// The first page always runs; later ones give way to waiting work.
function yieldBeforePage(deps: EmSyncPassDeps, iters: number): boolean {
    const reason = iters > 0 ? pullYieldReason(deps) : null;
    if (reason) deps.onYield?.(reason);
    return reason !== null;
}

interface PulledPage {
    nextDate: number;
    step: EmSyncPassDecision;
}

// Fetch one page and store it. null: the device answer was not usable.
async function pullAndStore(
    deps: EmSyncPassDeps,
    cursor: number
): Promise<PulledPage | null> {
    const block = await deps.fetchBlock(cursor);
    if (block === null) {
        deps.onInvalid?.();
        return null;
    }
    const nextDate = nextEmSyncCursor({
        nextTs: block.nextTs,
        data: block.data,
        lastSyncTs: cursor
    });
    const stored = await deps.storeBlock(nextDate, {
        ...block,
        requestedTs: cursor
    });
    const step = emSyncPassDecision({
        buffered: stored,
        nextDate,
        cursor,
        nextTs: block.nextTs,
        nowS: Math.floor(deps.now() / 1000),
        caughtUpSlackS: deps.caughtUpSlackS
    });
    if (step.bufferedOk) deps.onAcceptedCursor?.(nextDate);
    return {nextDate, step};
}

// One NotifyEvent "data" from an emdata:N / em1data:N component.
export interface EmRecordPush {
    device: ShellyDevice;
    component: string;
    event: unknown;
}

export interface EmHandler {
    evaluate(m: ShellyMessageIncoming, device: ShellyDevice): void;
    seedFromDevices(devices: ReadonlyArray<ShellyDevice>): Promise<void>;
    acceptRecordPush(push: EmRecordPush): void;
}

export interface EmHandlerDependencies {
    callDbMethod: typeof callMethod;
    findDevice: typeof DeviceCollector.getDevice;
    getPoolPressure: () => PoolPressure;
    readBufferPressure: typeof readEmSyncBufferPressure;
    // A place for one history page, oldest bookmark first.
    reservePullPage: (
        bookmark: number,
        wait: EmSyncPageWait
    ) => Promise<EmSyncPageRelease | null>;
    writePulledPage: (page: EmSyncBlock) => Promise<boolean>;
    enqueueRecords: typeof enqueueEmSyncRecords;
    scheduleSyncTick: (tick: () => void, intervalMs: number) => void;
}

const defaultEmHandlerDependencies: EmHandlerDependencies = {
    callDbMethod: callMethod,
    findDevice: DeviceCollector.getDevice,
    // em-sync borrows idle connections; it brakes for other work only.
    getPoolPressure: () => getQueryPoolPressure('em-sync'),
    readBufferPressure: readEmSyncBufferPressure,
    reservePullPage: (bookmark, wait) =>
        getEmSyncPullAdmission().reservePage(bookmark, wait),
    writePulledPage: (page) =>
        writeEmSyncPullPage(page, {
            callDb: callMethod,
            maxRows: tuning.energy.emSyncDrainerMaxRows
        }),
    enqueueRecords: enqueueEmSyncRecords,
    scheduleSyncTick: (tick, intervalMs) => {
        const timer = setInterval(tick, intervalMs);
        timer.unref?.();
    }
};

export const InitEm = (
    overrides: Partial<EmHandlerDependencies> = {}
): EmHandler => {
    const dependencies = {...defaultEmHandlerDependencies, ...overrides};
    interface EmSyncQueueEntry {
        locked: boolean;
        id: number;
        syncProfile: SyncProfile;
        offlineSince?: number;
        lane: EmSyncLane;
        nextEligibleTs: number; // when this device may run again
        seq: number; // re-stamped on completion — orders ties in FIFO
        failures: number; // consecutive failed passes, drives the back-off
        lastSyncedTs?: number; // freshness metric only — never schedules
        syncJitter: number;
        // Next visit pulls even a current channel: new connection or entry.
        forcePull: boolean;
        // A delete + recreate can reuse the external Shelly ID with a new DB
        // ID while the old entry is in flight. Apply that replacement only
        // when the old pass unlocks so one pass never spans two identities.
        pendingReplacement?: EmSyncQueueEntry;
    }
    const syncQueue = new Map<string, EmSyncQueueEntry>();
    // Each connection is a new device object; a first sight is a (re)connect.
    const seenConnections = new WeakSet<ShellyDevice>();
    const recordKeys = new EmRecordKeyCache();
    const recordKeyFetches = new Map<string, Promise<string[] | null>>();
    const identityRefreshes = new Map<string, number>();
    let identityRefreshSeq = 0;

    // Monotonic dispatch counter. Second-resolution timestamps tie for whole
    // batches of devices; this breaks those ties in completion order, which is
    // what makes the rotation provably starvation-free.
    let dispatchSeq = 0;

    // Track in-flight syncs so a sync stuck longer than it should is visible
    // (monitor-only — no reclaim).
    let activeSyncs = 0;
    let activeCatchupSyncs = 0;
    let activeChannels = 0;
    const STUCK_WARN_INTERVAL_MS = 30_000;
    const syncMonitor = new StuckMonitor('em_sync', STUCK_WARN_INTERVAL_MS, {
        now: () => Date.now(),
        setGauge: (name, value) => Observability.setGauge(name, value),
        warn: (message) => logger.warn(message),
        thresholdMs: () => tuning.rpc.emSyncStuckMs,
        gauges: {
            oldestHeldMs: 'em_sync_oldest_held_ms',
            stuck: 'em_sync_stuck'
        }
    });
    const channelLags = new Map<string, EmSyncChannelLag>();

    // Release a device's per-channel lag entries when it leaves the sync queue,
    // so this observability map can't grow without bound on device churn.
    function pruneEmSyncChannelLags(deviceId: number): void {
        const prefix = `${deviceId}:`;
        for (const key of channelLags.keys()) {
            if (key.startsWith(prefix)) channelLags.delete(key);
        }
    }

    function recordEmSyncChannelCursor(input: {
        deviceId: number;
        channel: number;
        cursor: number;
    }): void {
        const deviceId = String(input.deviceId);
        const key = `${deviceId}:${input.channel}`;
        const previousLagSeconds = channelLags.get(key)?.lagSeconds ?? 0;
        channelLags.set(key, {
            deviceId,
            channel: input.channel,
            lagSeconds: emSyncAcceptedLagSeconds({
                previousLagSeconds,
                cursor: input.cursor,
                nowS: Math.floor(Date.now() / 1000)
            })
        });
        const {worst, laggedChannels} = emSyncLagSnapshot({
            entries: channelLags.values(),
            caughtUpSlackSeconds: CATCHUP_CAUGHTUP_SLACK_S
        });
        Observability.setGauge(
            'em_sync_worst_channel_lag_seconds',
            worst.lagSeconds
        );
        Observability.setGauge('em_sync_lagged_channels', laggedChannels);
    }

    // Longest wait among devices that were due and did not get a slot. The
    // per-channel lag gauges above only ever see devices that WERE dispatched,
    // so they are structurally blind to a starved device; this is not.
    let oldestUnpickedWaitS = 0;
    // Latched "the sync loop is falling behind" flag, flipped by the tick when
    // the oldest un-dispatched wait crosses STARVATION_ALERT_S. Edge-logged so a
    // sustained condition warns once, not every second.
    let starvationSuspected = false;

    Observability.registerModule('emSync', {
        stats: () => {
            const {worst, laggedChannels, channelsBeyondCaughtUpSlack} =
                emSyncLagSnapshot({
                    entries: channelLags.values(),
                    caughtUpSlackSeconds: CATCHUP_CAUGHTUP_SLACK_S
                });
            return {
                queueSize: syncQueue.size,
                activeSyncs,
                activeCatchupSyncs,
                activeChannels,
                maxConcurrent: MAX_CONCURRENT_SYNCS,
                maxConcurrentChannels: MAX_CONCURRENT_CHANNELS,
                reservedCatchupSlots: RESERVED_CATCHUP_SLOTS,
                oldestUnpickedWaitSeconds: oldestUnpickedWaitS,
                starvationSuspected,
                starvationAlertThresholdSeconds: STARVATION_ALERT_S,
                oldestHeldMs: syncMonitor.oldestHeldMs(),
                stuck: syncMonitor.stuckCount(),
                worstChannelLagSeconds: worst.lagSeconds,
                laggedChannels,
                caughtUpSlackSeconds: CATCHUP_CAUGHTUP_SLACK_S,
                liveCadenceMaxSeconds: LIVE_CADENCE_MAX_S,
                channelsBeyondCaughtUpSlack,
                worstLagDeviceId: worst.deviceId,
                worstLagChannel: worst.channel
            };
        },
        topology: {
            role: 'transform',
            cluster: 'pipeline',
            upstreams: ['registry', 'statusQueue'],
            downstreams: ['dbPool'],
            label: 'EM Sync',
            description: 'Energy meter syncing',
            route: '/monitoring/services'
        }
    });

    // deviceId -> (channel -> last synced cursor). One entry per device that has
    // synced rows; devices absent from the map have none yet (zero-day).
    // Single batched read of every due device's per-channel cursor, replacing
    // the per-device + per-channel fn_last_sync round-trips on the hot path.
    // Returns null on failure so callers transparently fall back to per-device
    // reads (worst case = the pre-optimization behavior).
    type EmSyncCursorMap = Map<number, Map<number, number>>;
    const prefetchCursors = async (
        deviceIds: number[]
    ): Promise<EmSyncCursorMap | null> => {
        if (deviceIds.length === 0) return new Map();
        try {
            const {rows} = await dependencies.callDbMethod(
                'device_em.fn_last_sync_batch',
                {p_devices: deviceIds}
            );
            const map: EmSyncCursorMap = new Map();
            for (const r of rows as Array<{
                device: number;
                channel: number;
                created: string | number;
            }>) {
                const dev = Number(r.device);
                let chMap = map.get(dev);
                if (!chMap) {
                    chMap = new Map();
                    map.set(dev, chMap);
                }
                chMap.set(Number(r.channel), Number(r.created));
            }
            return map;
        } catch (err) {
            logger.warn(
                'EM cursor prefetch failed; falling back to per-device reads: %s',
                err
            );
            return null;
        }
    };

    // deviceId -> (channel -> earliest open hole below complete-up-to).
    type EmSyncHoleMap = Map<number, Map<number, EmSyncGap>>;

    // Holes the completeness scan stored below a bookmark. A failed read
    // leaves them for the next visit.
    const prefetchHoles = async (
        deviceIds: number[]
    ): Promise<EmSyncHoleMap> => {
        const holes: EmSyncHoleMap = new Map();
        if (deviceIds.length === 0) return holes;
        try {
            const {rows} = await dependencies.callDbMethod(
                'device_em.fn_em_sync_open_holes',
                {p_devices: deviceIds}
            );
            for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
                const device = Number(r.device);
                const channel = Number(r.channel);
                const from = Number(r.hole_from);
                const to = Number(r.hole_to);
                if (![device, channel, from, to].every(Number.isSafeInteger)) {
                    continue;
                }
                let channels = holes.get(device);
                if (!channels) {
                    channels = new Map();
                    holes.set(device, channels);
                }
                channels.set(channel, {from, to});
            }
        } catch (err) {
            logger.warn('EM hole prefetch failed: %s', err);
        }
        return holes;
    };

    interface EmSyncCursorSources {
        committed: EmSyncCursorMap | null;
        holes: EmSyncHoleMap;
    }

    // Read by the tick; a running pull checks it between pages.
    let pullPause: EmSyncPullPauseReason | null = null;

    // A failed probe leaves pulls running, as before the buffer had a budget.
    const readPullPause = async (): Promise<EmSyncPullPauseReason | null> => {
        try {
            const pressure = await dependencies.readBufferPressure();
            Observability.setGauge('em_sync_buffer_depth', pressure.depth);
            Observability.setGauge('em_sync_buffer_bytes', pressure.bytes);
            return emSyncPullPauseReason(pressure);
        } catch (err) {
            Observability.incrementCounter(
                'em_sync_buffer_pressure_probe_errors'
            );
            logger.debug('EM sync buffer pressure probe failed: %s', err);
            return null;
        }
    };

    const publishPullPause = (reason: EmSyncPullPauseReason | null): void => {
        Observability.setGauge('em_sync_catchup_buffer_paused', reason ? 1 : 0);
        for (const r of ['bytes', 'age'] as const) {
            Observability.setLabeledGauge(
                'em_sync_pull_paused',
                {reason: r},
                reason === r ? 1 : 0
            );
        }
    };

    let tickBusy = false;
    dependencies.scheduleSyncTick(
        () => fireAndForget('em-sync-tick', () => runSyncTick()),
        TICK_INTERVAL_MS
    );

    const runSyncTick = async (): Promise<void> => {
        // Re-entrancy guard: the batched cursor prefetch below is awaited, so a
        // slow prefetch must not let the next interval fire a second dispatch.
        if (tickBusy) return;
        syncMonitor.report();
        if (syncQueue.size === 0) return;
        initEmTuning();
        tickBusy = true;
        try {
            const now = Math.floor(Date.now() / 1000);
            const configuredChannels = [...syncQueue.values()].reduce(
                (sum, entry) =>
                    sum + Math.max(1, entry.syncProfile.channels.length),
                0
            );
            Observability.setGauge(
                'em_sync_required_live_entries_per_second',
                configuredChannels / Math.max(1, SYNC_THRESHOLD_S)
            );

            // Load gates, evaluated once per tick. DB pressure and push
            // buffer bytes or age suspend catch-up while live work keeps moving.
            const pressure = dependencies.getPoolPressure();
            pullPause = await readPullPause();
            publishPullPause(pullPause);

            const plan = pickDueEmSyncDevices({
                candidates: unlockedCandidates(),
                nowS: now,
                availableSlots: MAX_CONCURRENT_SYNCS - activeSyncs,
                availableChannels: MAX_CONCURRENT_CHANNELS - activeChannels,
                activeCatchupSlots: activeCatchupSyncs,
                reservedCatchupSlots: RESERVED_CATCHUP_SLOTS,
                poolWaiting: pressure.waitingCount > 0,
                poolHot: pressure.usage > CATCHUP_POOL_USAGE_PAUSE,
                catchupPaused: pullPause !== null
            });
            publishPlanGauges(plan);
            if (plan.dispatch.length === 0) return;

            // Read every picked device's cursors in one batched query.
            const internalIds = plan.dispatch
                .map((d) => syncQueue.get(d.id)?.id)
                .filter((v): v is number => v !== undefined);
            const [cursorMap, holes] = await Promise.all([
                prefetchCursors(internalIds),
                prefetchHoles(internalIds)
            ]);
            const cursorSources: EmSyncCursorSources = {
                committed: cursorMap,
                holes
            };
            for (const dispatch of plan.dispatch) {
                lockAndSync(dispatch, cursorSources);
            }
        } finally {
            tickBusy = false;
        }
    };

    // Tuning is not available at module load time.
    const initEmTuning = (): void => {
        if (emTuningInitialized) return;
        MAX_CONCURRENT_SYNCS = tuning.rpc.maxConcurrentEmSyncs;
        MAX_CONCURRENT_CHANNELS = tuning.rpc.maxConcurrentEmSyncChannels;
        // Held as a slot count, not a percentage, so the scheduler never
        // reproduces the arithmetic and the tests never assert on a ratio.
        RESERVED_CATCHUP_SLOTS = Math.min(
            Math.max(
                1,
                Math.floor(
                    (tuning.energy.emSyncCatchupSharePct / 100) *
                        MAX_CONCURRENT_SYNCS
                )
            ),
            Math.max(1, MAX_CONCURRENT_SYNCS - 1)
        );
        emTuningInitialized = true;
    };

    const unlockedCandidates = (): EmSyncCandidate[] => {
        const out: EmSyncCandidate[] = [];
        for (const [id, entry] of syncQueue) {
            if (entry.locked) continue;
            out.push({
                id,
                lane: entry.lane,
                nextEligibleTs: entry.nextEligibleTs,
                seq: entry.seq,
                channels: Math.max(1, entry.syncProfile.channels.length)
            });
        }
        return out;
    };

    const publishPlanGauges = (plan: {
        dueLive: number;
        dueCatchup: number;
        oldestUnpickedWaitS: number;
        channelBlocked: boolean;
    }): void => {
        oldestUnpickedWaitS = plan.oldestUnpickedWaitS;
        Observability.setGauge('em_sync_due_live', plan.dueLive);
        Observability.setGauge('em_sync_due_catchup', plan.dueCatchup);
        Observability.setGauge('em_sync_active_catchup', activeCatchupSyncs);
        Observability.setGauge('em_sync_active_channels', activeChannels);
        Observability.setGauge(
            'em_sync_oldest_unpicked_wait_seconds',
            plan.oldestUnpickedWaitS
        );
        if (plan.channelBlocked) {
            Observability.incrementCounter('em_sync_channel_cap_blocked');
        }
        updateStarvationSignal(plan.oldestUnpickedWaitS);
    };

    // The rule-5 signal: a 0/1 gauge plus one warn on each transition. Consumed
    // by whatever scrapes /metrics or reads the emSync health block — no Grafana
    // rule. A device waiting past STARVATION_ALERT_S means the sync loop cannot
    // keep the fleet current: either selection is unfair (fixed) or throughput
    // is short (raise concurrency / shard the drainer / dedicate the DB).
    const updateStarvationSignal = (oldestWaitS: number): void => {
        const suspected = oldestWaitS > STARVATION_ALERT_S;
        Observability.setGauge(
            'em_sync_starvation_suspected',
            suspected ? 1 : 0
        );
        if (suspected === starvationSuspected) return;
        starvationSuspected = suspected;
        if (suspected) {
            Observability.incrementCounter('em_sync_starvation_alerts');
            logger.warn(
                'EM sync falling behind: oldest un-dispatched device has waited %ds (> %ds). The sync loop cannot keep the fleet current — check drainer throughput and em-sync concurrency.',
                oldestWaitS,
                STARVATION_ALERT_S
            );
        } else {
            logger.info(
                'EM sync recovered: oldest un-dispatched wait back to %ds (< %ds).',
                oldestWaitS,
                STARVATION_ALERT_S
            );
        }
    };

    // Arming lives here, not in sync(), because sync() returns early on several
    // paths before its own try block. An entry that is never armed keeps the
    // smallest ordering key and becomes a permanent head-of-line blocker for
    // its lane; wrapping every path makes that unreachable.
    const armAfterPass = (
        id: string,
        deviceId: number,
        outcome: EmSyncChannelOutcome
    ): void => {
        const entry = syncQueue.get(id);
        // Evicted or replaced mid-pass — the new identity must keep its fresh
        // scheduling state rather than inherit the old identity's outcome.
        if (!entry || entry.id !== deviceId) return;
        const armed = armEmSync({
            outcome,
            prevLane: entry.lane,
            prevFailures: entry.failures,
            nowS: Math.floor(Date.now() / 1000),
            jitterS: entry.syncJitter,
            gentleS: SYNC_THRESHOLD_S,
            failBaseS: tuning.energy.emSyncFailBackoffBaseS,
            failMaxS: tuning.energy.emSyncFailBackoffMaxS
        });
        entry.lane = armed.lane;
        entry.nextEligibleTs = armed.nextEligibleTs;
        entry.failures = armed.failures;
        entry.seq = ++dispatchSeq;
    };

    const lockAndSync = async (
        dispatch: {id: string; lane: EmSyncLane},
        cursorSources: EmSyncCursorSources
    ) => {
        const {id, lane} = dispatch;
        // Charge the lane and channel count recorded AT DISPATCH: a device can
        // change lane mid-pass, and the counters must unwind what they wound.
        const channels = Math.max(
            1,
            syncQueue.get(id)?.syncProfile.channels.length ?? 1
        );
        activeSyncs++;
        activeChannels += channels;
        if (lane === 'catchup') activeCatchupSyncs++;
        syncMonitor.begin(id);
        let outcome: EmSyncChannelOutcome = 'failed';
        let lockedDeviceId: number | undefined;
        try {
            lockedDeviceId = await lock(id);
            if (lockedDeviceId !== undefined) {
                outcome = await sync(id, lockedDeviceId, cursorSources);
            }
        } catch (e) {
            logger.warn(`EM sync error for ${id}: ${e}`);
            Observability.incrementCounter('em_syncs_failed');
            // Ensure unlock on unexpected errors
            try {
                if (lockedDeviceId !== undefined) {
                    unlock(id, lockedDeviceId);
                }
            } catch (_) {
                /* already unlocked or removed */
            }
        } finally {
            activeSyncs--;
            activeChannels -= channels;
            if (lane === 'catchup') activeCatchupSyncs--;
            if (lockedDeviceId !== undefined) {
                armAfterPass(id, lockedDeviceId, outcome);
            }
            syncMonitor.end(id);
        }
    };

    const lock = async (id: string): Promise<number | undefined> => {
        const sd = syncQueue.get(id);
        if (sd && sd.locked === true) {
            return undefined;
        }
        if (!sd?.id) {
            throw new Error('InternalIdIsRequired');
        }
        sd.locked = true;
        syncQueue.set(id, sd);
        return sd.id;
    };
    const unlock = (id: string, deviceId: number): void => {
        const sd = syncQueue.get(id);
        if (!sd?.id) {
            throw new Error('InternalIdIsRequired');
        }
        if (sd.id !== deviceId) return;
        sd.locked = false;
        const replacement = sd.pendingReplacement;
        if (!replacement) {
            syncQueue.set(id, sd);
            return;
        }
        pruneEmSyncChannelLags(sd.id);
        syncQueue.set(id, replacement);
    };
    const addForSync = async (
        device: ShellyDevice,
        syncProfile: SyncProfile
    ) => {
        const shellyId = device.shellyID;
        const existing = syncQueue.get(shellyId);
        if (existing?.id === device.id) return;
        const refreshSeq = ++identityRefreshSeq;
        identityRefreshes.set(shellyId, refreshSeq);

        const buildEntry = async (): Promise<EmSyncQueueEntry> => {
            // Load last sync timestamp from DB so we don't re-query it every tick.
            // Empty rows = first sync, which is fine. A thrown error here is a
            // real DB problem (pool, missing function) and must surface — the
            // bare catch used to mask it and re-sync from epoch every tick.
            let lastSyncedTs: number | undefined;
            try {
                const {rows} = await dependencies.callDbMethod(
                    'device_em.fn_last_sync',
                    {p_device: device.id, p_channel: -1}
                );
                if (rows.length > 0) {
                    const cursor = Number(rows[0].created);
                    // Ignore the CURSOR, never the device. Returning here left
                    // the device out of the queue entirely, and out of the
                    // `syncQueue.get` memo above, so every incoming message
                    // from it re-ran both DB probes for good.
                    if (isEmSyncCursorPlausible(cursor, Date.now() / 1000)) {
                        lastSyncedTs = cursor;
                    } else {
                        logger.warn(
                            'Ignoring future EM sync cursor device=%s cursor=%d',
                            shellyId,
                            cursor
                        );
                        Observability.incrementCounter(
                            'em_sync_future_cursors_rejected'
                        );
                    }
                }
            } catch (err) {
                logger.warn(
                    'fn_last_sync probe failed device=%s; treating as first sync: %s',
                    shellyId,
                    err
                );
            }
            const nowS = Math.floor(Date.now() / 1000);
            return {
                locked: false,
                id: device.id,
                syncProfile,
                // The only place lag is ever read. Seeded against the slack the
                // pass itself uses to decide it is caught up, so a live-lane
                // device is cheap by construction. Every later lane change
                // comes from a pass outcome.
                lane:
                    lastSyncedTs === undefined ||
                    nowS - lastSyncedTs > CATCHUP_CAUGHTUP_SLACK_S
                        ? 'catchup'
                        : 'live',
                nextEligibleTs: nowS,
                seq: ++dispatchSeq,
                failures: 0,
                lastSyncedTs,
                syncJitter: emSyncJitterSeconds(),
                forcePull: true
            };
        };

        const replacement = await buildEntry();
        // Do not let a slower, older add overwrite a newer identity request
        // that arrived while the bookmark probe was in flight.
        if (identityRefreshes.get(shellyId) !== refreshSeq) return;
        identityRefreshes.delete(shellyId);
        const current = syncQueue.get(shellyId);
        if (current?.id === device.id) return;
        if (current?.locked) {
            current.pendingReplacement = replacement;
            return;
        }
        if (current) pruneEmSyncChannelLags(current.id);
        syncQueue.set(shellyId, replacement);
    };
    // Store one pulled block in the database: its records plus the ranges
    // inside its claim the device had no record for, with the bookmark, in one
    // transaction per piece. false => not stored: the caller stops the pass so
    // the bookmark never advances past a block that is not in the database.
    const storePulledBlock = async (input: {
        fields: MeasurementField[];
        device: number;
        channel: number;
        block: EmSyncFetchedBlock;
        claimedUntil: number;
    }): Promise<boolean> => {
        if (Observability.isDbWritesDisabled()) {
            Observability.incrementCounter('em_sync_writes_skipped');
            return false;
        }
        const {usable, rejected} = usableRecordBlocks({
            data: input.block.data,
            nowS: Math.floor(Date.now() / 1000)
        });
        if (rejected > 0) {
            Observability.incrementCounter(
                'em_sync_record_bad_clock',
                rejected
            );
        }
        const rows = buildEmStatsBatch({
            fields: input.fields,
            payload: {keys: input.block.keys, data: usable},
            device: input.device,
            channel: input.channel
        });
        const gaps = deviceGapsInPull({
            requestedTs: input.block.requestedTs,
            claimedUntil: input.claimedUntil,
            rows
        });
        const cursor: EmSyncCursor = {
            device: input.device,
            channel: input.channel,
            created: input.claimedUntil
        };
        if (gaps.length > 0) cursor.gaps = gaps;
        const stored = await dependencies.writePulledPage({rows, cursor});
        if (stored) recordPulledBlock({records: recordCount(usable), gaps});
        return stored;
    };

    const recordPulledBlock = (input: {
        records: number;
        gaps: readonly EmSyncGap[];
    }): void => {
        Observability.incrementCounter('em_sync_pull_records', input.records);
        const gapSeconds = input.gaps.reduce(
            (sum, gap) => sum + (gap.to - gap.from),
            0
        );
        if (gapSeconds > 0) {
            Observability.incrementCounter(
                'em_sync_device_gap_minutes',
                Math.ceil(gapSeconds / 60)
            );
        }
    };

    // Key list of a record component, from the device itself: asked once per
    // firmware with a one-record GetData, shared by concurrent pushes.
    const resolveRecordKeys = async (input: {
        device: ShellyDevice;
        method: string;
        channel: number;
        ts: number;
    }): Promise<string[] | null> => {
        const cacheKey = recordKeyCacheKey(
            input.device,
            recordComponentOf(input.method, input.channel)
        );
        const known = recordKeys.get(cacheKey);
        if (known) return known;
        let pending = recordKeyFetches.get(cacheKey);
        if (!pending) {
            pending = fetchRecordKeys(input).finally(() =>
                recordKeyFetches.delete(cacheKey)
            );
            recordKeyFetches.set(cacheKey, pending);
        }
        const keys = await pending;
        if (keys) recordKeys.set(cacheKey, keys);
        return keys;
    };

    const fetchRecordKeys = async (input: {
        device: ShellyDevice;
        method: string;
        channel: number;
        ts: number;
    }): Promise<string[] | null> => {
        try {
            const answer = (await input.device.sendRPC(input.method, {
                id: input.channel,
                ts: input.ts,
                end_ts: input.ts
            })) as {keys?: unknown} | null;
            const keys = answer?.keys;
            return Array.isArray(keys) &&
                keys.every((k) => typeof k === 'string')
                ? keys
                : null;
        } catch (err) {
            logger.warn(
                'EM record keys unavailable device=%s method=%s channel=%d: %s',
                input.device.shellyID,
                input.method,
                input.channel,
                err
            );
            return null;
        }
    };

    // The queued sync profile entry a pushed component belongs to, or null.
    const pushTarget = (
        device: ShellyDevice,
        component: string
    ): {entry: EmSyncQueueEntry; method: string; channel: number} | null => {
        const [type, id] = component.split(':');
        const method = RECORD_COMPONENT_METHODS[type];
        const channel = Number.parseInt(id ?? '', 10);
        const entry = syncQueue.get(device.shellyID);
        if (
            !method ||
            Number.isNaN(channel) ||
            entry?.id !== device.id ||
            entry.syncProfile.method !== method ||
            !entry.syncProfile.channels.includes(channel)
        ) {
            return null;
        }
        return {entry, method, channel};
    };

    const storeRecordPush = async (push: EmRecordPush): Promise<void> => {
        // Other components may name an event "data" too.
        if (
            typeof push.component !== 'string' ||
            !RECORD_COMPONENT_METHODS[push.component.split(':')[0]]
        ) {
            return;
        }
        Observability.incrementCounter('em_sync_push_received');
        const target = pushTarget(push.device, push.component);
        const data = (push.event as {data?: unknown} | null)?.data;
        if (!target || !isRecordBlockArray(data)) {
            Observability.incrementCounter('em_sync_push_rejected');
            return;
        }
        const nowS = Math.floor(Date.now() / 1000);
        const {usable, rejected} = usableRecordBlocks({data, nowS});
        if (rejected > 0) {
            Observability.incrementCounter(
                'em_sync_record_bad_clock',
                rejected
            );
        }
        if (usable.length === 0) return;
        for (const block of usable) {
            recordEmSyncPushDelay(
                nowS - (recordBlockEnd(block) ?? nowS),
                push.device.info?.app
            );
        }
        await bufferRecordPush({push, target, usable});
    };

    const bufferRecordPush = async (input: {
        push: EmRecordPush;
        target: {entry: EmSyncQueueEntry; method: string; channel: number};
        usable: EmDataBlock[];
    }): Promise<void> => {
        const {push, target, usable} = input;
        const keys = await resolveRecordKeys({
            device: push.device,
            method: target.method,
            channel: target.channel,
            ts: usable[0].ts
        });
        if (!keys) {
            Observability.incrementCounter('em_sync_push_keys_unavailable');
            return;
        }
        if (Observability.isDbWritesDisabled()) {
            Observability.incrementCounter('em_sync_writes_skipped');
            return;
        }
        const phases = target.entry.syncProfile.phases;
        if (!hasStoredFields({keys, phases})) return;
        const records: EmSyncRecordPush = {
            device: push.device.id,
            channel: target.channel,
            ...(phases ? {phases} : {}),
            keys,
            blocks: usable
        };
        const queued = await dependencies.enqueueRecords(records);
        // A push the buffer refused is filled by the next pull.
        Observability.incrementCounter(
            queued ? 'em_sync_push_records' : 'em_sync_push_rejected',
            queued ? recordCount(usable) : 1
        );
    };

    // A device object not seen before is a new connection: pull on its next
    // visit, and visit soon, to fill what was missed while it was away.
    const noteConnection = (device: ShellyDevice): void => {
        if (seenConnections.has(device)) return;
        seenConnections.add(device);
        const entry = syncQueue.get(device.shellyID);
        if (entry?.id !== device.id) return;
        entry.forcePull = true;
        entry.nextEligibleTs = Math.min(
            entry.nextEligibleTs,
            Math.floor(Date.now() / 1000)
        );
    };

    // Next stored record per channel after its bookmark, so a gap-fill pull
    // asks only for the hole. A failed read pulls without an end.
    const readNextStored = async (
        deviceId: number
    ): Promise<Map<number, number>> => {
        const next = new Map<number, number>();
        try {
            const {rows} = await dependencies.callDbMethod(
                'device_em.fn_em_sync_positions',
                {p_devices: [deviceId]}
            );
            for (const r of (rows ?? []) as Array<{
                channel?: unknown;
                next_stored?: unknown;
            }>) {
                const stored = Number(r.next_stored);
                if (r.channel === undefined || r.next_stored == null) continue;
                if (Number.isSafeInteger(stored)) {
                    next.set(Number(r.channel), stored);
                }
            }
        } catch (err) {
            logger.warn(
                'EM next stored record read failed device=%d: %s',
                deviceId,
                err
            );
        }
        return next;
    };

    interface SyncChannelInput {
        deviceId: number;
        shellyId: string;
        shellyDev: ShellyDevice;
        channel: number;
        method: string;
        fields: MeasurementField[];
        // Batched-prefetch fast path: when `prefetched` is true the per-channel
        // cursor comes from the once-per-cycle fn_last_sync_batch read instead
        // of a per-channel DB round-trip. `prefetchedCursor` undefined here =
        // channel has no synced rows yet (skip, same as the read path's empty).
        prefetched: boolean;
        prefetchedCursor?: number;
        // First stored record after the cursor: the pull ends there.
        endTs?: number;
    }

    interface SyncChannelResult {
        outcome: EmSyncChannelOutcome;
        cursor?: number;
    }

    // Every return site classifies EXPLICITLY. A failed write (database
    // outage, writes disabled) surfaces as 'failed', never as 'no_data' — a
    // fall-through default there would quietly park the whole fleet on the
    // gentle cadence with zero ingestion and no alarm.
    const syncOneChannel = async (
        input: SyncChannelInput
    ): Promise<SyncChannelResult> => {
        const {deviceId, shellyId, shellyDev, channel, method, fields} = input;
        const timer = new StageTimer();
        // Reclaim the concurrency slot even if the device stops answering.
        const reclaim = new AbortController();
        const reclaimTimer = setTimeout(
            () => reclaim.abort(),
            tuning.rpc.emSyncReclaimMs
        );
        try {
            // Resolve the start cursor. Fast path: use the per-cycle batched
            // prefetch (no DB hit here). Fallback path (prefetch failed): the
            // original per-channel fn_last_sync read, preserved verbatim so a
            // prefetch failure degrades to today's exact behavior.
            let cursor: number;
            if (input.prefetched) {
                if (input.prefetchedCursor === undefined) {
                    Observability.incrementCounter('em_syncs_skipped_no_data');
                    return {outcome: 'no_data'};
                }
                cursor = input.prefetchedCursor;
            } else {
                const lastSyncResult = await dependencies.callDbMethod(
                    'device_em.fn_last_sync',
                    {p_device: deviceId, p_channel: channel}
                );
                timer.mark('last_sync');
                if (!lastSyncResult?.rows?.[0]?.created) {
                    logger.warn(
                        `EM Sync: no last_sync row for device=${deviceId} channel=${channel}, skipping`
                    );
                    Observability.incrementCounter('em_syncs_skipped_no_data');
                    return {outcome: 'no_data'};
                }
                cursor = Number.parseInt(lastSyncResult.rows[0].created, 10);
            }
            recordEmSyncChannelCursor({deviceId, channel, cursor});
            // Drain the backlog this pass, lower-priority than live work.
            const {endTs} = input;
            const deadlineMs = Date.now() + CATCHUP_MAX_MS;
            const {lastGood, iters, deferred} = await runEmSyncPass({
                startCursor: cursor,
                endTs,
                maxIters: catchupAllowed(deviceId) ? CATCHUP_MAX_ITERS : 1,
                deadlineMs,
                now: () => Date.now(),
                pausePct: CATCHUP_POOL_USAGE_PAUSE,
                caughtUpSlackS: CATCHUP_CAUGHTUP_SLACK_S,
                interBatchMs: CATCHUP_INTER_BATCH_MS,
                signal: reclaim.signal,
                // A page waits for room at most until the pass deadline, so
                // a waiting pass never reads as stuck.
                reservePage: (bookmark) =>
                    dependencies.reservePullPage(bookmark, {
                        signal: reclaim.signal,
                        deadlineMs
                    }),
                poolPressure: dependencies.getPoolPressure,
                bufferPause: () => pullPause,
                onYield: (reason) => {
                    Observability.incrementCounter('em_sync_catchup_yielded');
                    Observability.incrementLabeledCounter(
                        'em_sync_pull_pauses_total',
                        {reason}
                    );
                },
                onInvalid: () => {
                    logger.warn(
                        `EM Sync: invalid RPC response for device=${deviceId} channel=${channel}`
                    );
                    Observability.incrementCounter('em_syncs_skipped_no_data');
                },
                onAcceptedCursor: (acceptedCursor) =>
                    recordEmSyncChannelCursor({
                        deviceId,
                        channel,
                        cursor: acceptedCursor
                    }),
                fetchBlock: async (c) => {
                    const rpcStarted = Date.now();
                    const rpcResult = await shellyDev.sendRPC(
                        method,
                        endTs !== undefined && c < endTs
                            ? {id: channel, ts: c, end_ts: endTs - 1}
                            : {id: channel, ts: c},
                        false,
                        reclaim.signal
                    );
                    Observability.setGauge(
                        'em_sync_last_rpc_fetch_ms',
                        Date.now() - rpcStarted
                    );
                    if (
                        !rpcResult ||
                        typeof rpcResult !== 'object' ||
                        !Array.isArray(rpcResult.keys)
                    ) {
                        return null;
                    }
                    Observability.incrementCounter('em_sync_blocks_fetched');
                    const {
                        keys,
                        data,
                        next_record_ts: nextTs
                    } = rpcResult as {
                        keys: string[];
                        data: EmDataBlock[];
                        next_record_ts: number;
                    };
                    const sampleRows = data.reduce(
                        (sum, block) => sum + (block.values?.length ?? 0),
                        0
                    );
                    Observability.setGauge(
                        'em_sync_last_rpc_records',
                        sampleRows
                    );
                    recordKeys.set(
                        recordKeyCacheKey(
                            shellyDev,
                            recordComponentOf(method, channel)
                        ),
                        keys
                    );
                    return {keys, data, nextTs};
                },
                // If a block isn't stored, runEmSyncPass stops the pass so the
                // bookmark never moves past an undelivered block.
                storeBlock: async (nextDate, block) => {
                    const queued = syncQueue.get(shellyId);
                    const collected = dependencies.findDevice(shellyId);
                    if (
                        queued?.id !== deviceId ||
                        queued.pendingReplacement !== undefined ||
                        collected?.id !== deviceId
                    ) {
                        Observability.incrementCounter(
                            'em_sync_identity_change_aborts'
                        );
                        logger.info(
                            'EM Sync: discarded stale response after identity change shellyId=%s oldDevice=%d queuedDevice=%s collectedDevice=%s',
                            shellyId,
                            deviceId,
                            queued?.id,
                            collected?.id
                        );
                        return false;
                    }
                    return storePulledBlock({
                        fields,
                        device: deviceId,
                        channel,
                        block,
                        claimedUntil: pullClaimEnd({
                            nextDate,
                            nextTs: block.nextTs,
                            endTs
                        })
                    });
                }
            });

            timer.mark('drain');
            Observability.incrementCounter('em_sync_catchup_batches', iters);
            Observability.setGauge('em_sync_last_pass_blocks', iters);
            Observability.setGauge('em_sync_last_pass_ms', timer.totalMs());
            if (timer.totalMs() >= EMSYNC_PASS_SLOW_MS) {
                logger.warn(
                    'slow em-sync pass device=%d channel=%d blocks=%d total=%dms %s',
                    deviceId,
                    channel,
                    iters,
                    timer.totalMs(),
                    timer.format()
                );
            }
            logger.info(
                `Query Finished device=${deviceId} for channel=${channel} @ nextDate=${lastGood} (${iters} block(s))`
            );
            if (lastGood === undefined) {
                if (deferred) {
                    // The database had no room before the deadline; the
                    // channel is still behind and nothing was fetched.
                    Observability.incrementCounter('em_sync_pull_deferred');
                    return {outcome: 'deferred'};
                }
                // Blocks were pulled but none landed — a failed write or a
                // malformed response, not a caught-up channel.
                if (iters > 0) {
                    Observability.incrementCounter('em_syncs_channel_failed');
                    return {outcome: 'failed'};
                }
                return {outcome: 'at_edge'};
            }
            return {
                outcome: lastGood > cursor ? 'advanced' : 'at_edge',
                cursor: lastGood
            };
        } catch (err) {
            // Per-channel failure isolation — siblings still complete.
            Observability.incrementCounter('em_syncs_channel_failed');
            logger.warn(
                `EM Sync: channel failed device=${deviceId} channel=${channel}: ${err}`
            );
            return {outcome: 'failed'};
        } finally {
            clearTimeout(reclaimTimer);
        }
    };

    // Seed the 90-day start bookmark for channels that have none, so a channel
    // added after the device's first sync cannot stay invisible forever.
    const seedZeroDay = async (
        deviceId: number,
        channels: number[]
    ): Promise<number> => {
        const ts = day0();
        await Promise.all(
            channels.map(async (ch) => {
                logger.info(
                    `Pushing zero day! for id: ${deviceId}, channel: ${ch}, ts: ${ts}`
                );
                if (Observability.isDbWritesDisabled()) {
                    Observability.incrementCounter('em_sync_writes_skipped');
                    return;
                }
                return await dependencies.callDbMethod('device_em.fn_synced', {
                    p_device: deviceId,
                    p_created: ts,
                    p_channel: ch
                });
            })
        );
        return ts;
    };

    // Per-channel cursors for this pass. The prefetch is the fast path; the
    // fallback reads each channel individually. It must NOT read p_channel=-1:
    // that is MAX(created) in SQL, which is exactly the device-level gate that
    // let one current channel hide a months-behind sibling.
    const resolveChannelCursors = async (input: {
        deviceId: number;
        channels: number[];
        cursorSources: EmSyncCursorSources;
    }): Promise<Map<number, number>> => {
        const {deviceId, channels, cursorSources} = input;
        let committed: Map<number, number>;
        if (cursorSources.committed) {
            committed = cursorSources.committed.get(deviceId) ?? new Map();
        } else {
            const entries = await Promise.all(
                channels.map(async (ch) => {
                    const {rows} = await dependencies.callDbMethod(
                        'device_em.fn_last_sync',
                        {p_device: deviceId, p_channel: ch}
                    );
                    const created = rows?.[0]?.created;
                    return created === undefined
                        ? null
                        : ([ch, Number(created)] as const);
                })
            );
            committed = new Map(
                entries.filter((e): e is [number, number] => e !== null)
            );
        }
        return committed;
    };

    const sync = async (
        shellyId: string,
        expectedDeviceId: number,
        cursorSources: EmSyncCursorSources
    ): Promise<EmSyncChannelOutcome> => {
        const device = syncQueue.get(shellyId);
        const id = device?.id;
        if (!id || id !== expectedDeviceId) {
            return 'failed';
        }

        // Check online FIRST — before any DB calls
        const shellyDev = dependencies.findDevice(shellyId) as
            | ShellyDevice
            | undefined;
        if (!shellyDev) {
            // Device fully deleted — remove immediately (no unlock needed, entry is gone)
            syncQueue.delete(shellyId);
            pruneEmSyncChannelLags(id);
            logger.info(
                `EM Sync: removed deleted device ${id} from sync queue`
            );
            return 'failed';
        }
        if (shellyDev.id !== id) {
            // The collector has already admitted a recreated device but its
            // queue replacement is still probing the bookmark. Do not send
            // the new device's RPC data to the old database identity.
            unlock(shellyId, id);
            return 'failed';
        }
        if (!shellyDev.online) {
            // Device offline — apply grace period
            if (!device.offlineSince) {
                device.offlineSince = Date.now();
            }
            if (Date.now() - device.offlineSince > EM_SYNC_GRACE_PERIOD_MS) {
                syncQueue.delete(shellyId);
                pruneEmSyncChannelLags(id);
                logger.info(
                    `EM Sync: removed device ${id} after ${EM_SYNC_GRACE_PERIOD_MS / 1000}s offline`
                );
            } else {
                Observability.incrementCounter('em_syncs_skipped_offline');
                unlock(shellyId, id);
            }
            // An offline device is at the live edge of what it can give, so it
            // falls back to the gentle beat instead of retrying every 2s.
            return 'no_data';
        }

        // Device is online — reset offline timer
        device.offlineSince = undefined;

        logger.info(`EM Sync started for device: ${id}`);
        try {
            const params = device.syncProfile;
            const channels = params.channels || [];
            const chCursors = await resolveChannelCursors({
                deviceId: id,
                channels,
                cursorSources
            });

            // Seed only the channels that are missing a bookmark. Seeding the
            // whole device would skip the channels that already have one.
            const unseeded = channels.filter((ch) => !chCursors.has(ch));
            if (unseeded.length > 0) {
                const seededAt = await seedZeroDay(id, unseeded);
                seedMissingEmSyncCursors({
                    cursors: chCursors,
                    channels: unseeded,
                    seededAt
                });
                device.lastSyncedTs = seededAt;
            }

            // Gate PER CHANNEL. The old device-level MAX(cursor) gate meant one
            // current channel returned early for the whole device and its
            // behind siblings were never pulled — silent billing-data loss.
            const nowS = Math.floor(Date.now() / 1000);
            const holes = cursorSources.holes.get(id) ?? new Map();
            const dueChannels = channels.filter((ch) => {
                const cursor = chCursors.get(ch);
                if (holes.has(ch)) return true;
                return (
                    cursor !== undefined &&
                    isEmPullDue({
                        cursor,
                        nowS,
                        graceS: PULL_GRACE_S,
                        forced: device.forcePull
                    })
                );
            });
            device.forcePull = false;
            if (dueChannels.length === 0) {
                const newest = Math.max(...chCursors.values());
                device.lastSyncedTs = newest;
                logger.info(
                    `Device: ${id} last record(${newest}) is not in the past`
                );
                return 'at_edge';
            }

            const fields = measurementFields(params?.phases);
            const nextStored = await readNextStored(id);
            // Channels run in parallel — each is an independent device RPC
            // round-trip + DB batch. Per-channel errors don't sink the others.
            const channelResults = await Promise.all(
                dueChannels.map((channel) =>
                    syncOneChannel({
                        deviceId: id,
                        shellyId,
                        shellyDev,
                        channel,
                        method: params.method,
                        fields,
                        prefetched: true,
                        prefetchedCursor:
                            holes.get(channel)?.from ?? chCursors.get(channel),
                        endTs: holes.get(channel)?.to ?? nextStored.get(channel)
                    })
                )
            );
            const outcome = resolveDeviceOutcome(
                channelResults.map((r) => r.outcome)
            );
            if (
                outcome === 'advanced' &&
                channelResults.some((r) => r.outcome === 'failed')
            ) {
                Observability.incrementCounter(
                    'em_sync_partial_channel_failure'
                );
            }
            // Freshness metric only — nothing schedules on it.
            const cursors = channelResults
                .map((r) => r.cursor)
                .filter((c): c is number => c !== undefined);
            if (cursors.length > 0) {
                device.lastSyncedTs = Math.max(...cursors);
            }
            return outcome;
        } catch (e) {
            logger.warn(e);
            logger.warn(`Sync error for device: ${id}`);
            return 'failed';
        } finally {
            logger.info(`Sync finished for device: ${id}`);
            Observability.incrementCounter('em_syncs_completed');
            unlock(shellyId, id);
        }
    };
    const o = {
        evaluate(_m: ShellyMessageIncoming, device: ShellyDevice): void {
            noteConnection(device);
            (async () => {
                const profile = detectSyncProfile(device);
                if (!profile) return;
                await addForSync(device, profile);
            })().catch((e) =>
                logger.warn('EM evaluate error for %s: %s', device.shellyID, e)
            );
        },
        // Boot-time priming: seed every known EM device into the sync queue
        // so the first sync window doesn't wait for an incoming NotifyStatus.
        async seedFromDevices(
            devices: ReadonlyArray<ShellyDevice>
        ): Promise<void> {
            // Serial awaits made boot pay 2 DB round-trips per EM device.
            const targets = devices
                .map((device) => ({
                    device,
                    profile: detectSyncProfile(device)
                }))
                .filter((t) => t.profile !== null);
            await runBoundedParallel({
                tasks: targets,
                run: (t) => addForSync(t.device, t.profile!),
                concurrency: BOOT_SEED_CONCURRENCY,
                perTaskTimeoutMs: BOOT_SEED_TASK_TIMEOUT_MS,
                label: 'em-boot-seed'
            });
            Observability.incrementCounter(
                'em_syncs_seeded_at_boot',
                targets.length
            );
            logger.info(`EM Sync: seeded ${targets.length} device(s) at boot`);
        },
        acceptRecordPush(push: EmRecordPush): void {
            fireAndForget('em-record-push', () => storeRecordPush(push));
        }
    };
    return o;
};
