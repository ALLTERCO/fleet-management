import * as log4js from 'log4js';
import {tuning} from '../config';
import {envInt} from '../config/envReader';
import type ShellyDevice from '../model/ShellyDevice';
import * as DeviceCollector from '../modules/DeviceCollector';
import type {ShellyMessageIncoming} from '../types';
import type {EmSyncBlock} from './device/emSyncCoalescer';
import {enqueueEmSyncBlock} from './device/emSyncStream';
import type {EmSyncCursor} from './energyRollup';
import * as Observability from './Observability';
import {callMethod, get, getQueryPoolPressure} from './PostgresProvider';
import {StuckMonitor} from './util/inFlightStuck';
import {runBoundedParallel} from './util/runBoundedParallel';
import {StageTimer} from './util/stageTimer';

type SyncProfile = {
    method: string;
    channels: number[];
    phases?: string[];
};

type MeasurementField = {
    name: string;
    phase?: string;
    ref: string;
};

const BOOT_SEED_CONCURRENCY = 8;
const BOOT_SEED_TASK_TIMEOUT_MS = 10_000;
const logger = log4js.getLogger('message-parser');

type EmDataBlock = {period: number; ts: number; values: number[][]};

// Epoch of the last record actually returned in a GetData batch (a block holds
// values[0] at ts, then one every `period` seconds).
function lastConsumedRecordTs(data: EmDataBlock[]): number | undefined {
    let last: number | undefined;
    for (const block of data) {
        if (!Array.isArray(block.values) || block.values.length === 0) continue;
        const blockLast = block.ts + block.period * (block.values.length - 1);
        if (last === undefined || blockLast > last) last = blockLast;
    }
    return last;
}

// Prefer the device's next_record_ts; when absent, resume from the last stored
// record so the window since it is never skipped, else hold the prior cursor.
export function nextEmSyncCursor(input: {
    nextTs: number | undefined;
    data: EmDataBlock[];
    lastSyncTs: number;
}): number {
    if (typeof input.nextTs === 'number' && input.nextTs > 0) {
        return input.nextTs;
    }
    return lastConsumedRecordTs(input.data) ?? input.lastSyncTs;
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
const dataFields = [
    'total_act_energy',
    'total_act_ret_energy',
    'min_voltage',
    'max_voltage',
    'total_current',
    'min_current',
    'max_current'
] as const;

type DataField = (typeof dataFields)[number];

function baseMeasurementField(field: DataField): MeasurementField {
    return {name: field, ref: field};
}

function phasedMeasurementFields(
    field: DataField,
    phases: string[]
): MeasurementField[] {
    return phases.map((phase) => ({
        name: `${phase}_${field}`,
        phase,
        ref: field
    }));
}

function measurementFields(phases?: string[]): MeasurementField[] {
    return dataFields.flatMap((field) => {
        if (!phases) return [baseMeasurementField(field)];
        return phasedMeasurementFields(field, phases);
    });
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

const timeThreshold = (threshold: number): ((check: number) => boolean) => {
    return (check: number): boolean => {
        return Math.floor(Date.now() / 1000) - check > threshold;
    };
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
const inPast = timeThreshold(SYNC_THRESHOLD_S);
const EM_SYNC_GRACE_PERIOD_MS = envInt(
    'FM_EMDATA_GRACE_PERIOD_MS',
    5 * 60 * 1000
);
let MAX_CONCURRENT_SYNCS = 40;
let emTuningInitialized = false;
const TICK_INTERVAL_MS = envInt('FM_EMDATA_TICK_INTERVAL_MS', 1000);
// A channel sync pass slower than this logs a one-line stage breakdown
// (last_sync vs drain) so the slow part of a pass is visible per device.
const EMSYNC_PASS_SLOW_MS = envInt('FM_EMDATA_PASS_SLOW_MS', 5000);

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
// Lag-adaptive cadence: a device whose data lags more than BEHIND_LAG_S past
// now re-dispatches almost immediately (BEHIND_CADENCE_S) so it drains
// back-to-back; once it's within BEHIND_LAG_S of now it falls back to the
// normal gentle SYNC_THRESHOLD cadence. Self-regulating — each device speeds up
// when far behind and eases off as it nears real time, with no manual switch.
// The fast cadence only applies while the DB pool is healthy (see the per-tick
// pressure gate), so lag-adaptation never overrides load-adaptation.
const CATCHUP_BEHIND_LAG_S = envInt('FM_EMDATA_CATCHUP_BEHIND_LAG_S', 1800);
const CATCHUP_BEHIND_CADENCE_S = envInt(
    'FM_EMDATA_CATCHUP_BEHIND_CADENCE_S',
    2
);
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

// Build the raw-stats batch from an em-data payload: map each field to its
// column, drop NaN/Infinity, default a missing phase to 'z'.
export function buildEmStatsBatch(input: {
    fields: MeasurementField[];
    payload: {
        keys: string[];
        data: {ts: number; period: number; values: number[][]}[];
    };
    device: number;
    channel: number;
}): EmSyncBlock['rows'] {
    const dataIndexes = input.fields
        .map((v) => ({...v, idx: input.payload.keys.indexOf(v.name)}))
        .filter((v) => v.idx > -1);
    const rows: EmSyncBlock['rows'] = {
        p_device: [],
        p_tag: [],
        p_domain: [],
        p_phase: [],
        p_channel: [],
        p_ts: [],
        p_val: [],
        p_source: 'em_sync' // the 1-minute meter record — billing-grade
    };
    for (const {values, ts, period} of input.payload.data) {
        // Each row in `values` is one record `period` seconds after the block
        // start: row j sits at ts + j*period. Using the block `ts` for every
        // row collapses all records onto one timestamp, which the DISTINCT ON
        // dedup in fn_append_stats[_synced] and the 15-min rollup then reduce
        // to a single surviving minute — silently dropping the rest (the ~6x
        // energy under-count). The bookmark already advances by period*n (see
        // lastConsumedRecordTs); the stored rows must match that grid.
        for (let j = 0; j < values.length; j++) {
            const el1 = values[j];
            const rowTs = ts + j * period;
            for (const {idx, ref, phase} of dataIndexes) {
                const val = el1[idx];
                if (!Number.isFinite(val)) continue;
                rows.p_device.push(input.device);
                rows.p_tag.push(ref);
                rows.p_domain.push('ac_mains');
                rows.p_phase.push(phase || 'z');
                rows.p_channel.push(input.channel);
                rows.p_ts.push(rowTs);
                rows.p_val.push(val);
            }
        }
    }
    return rows;
}

export interface EmSyncRpcBlock {
    keys: string[];
    data: EmDataBlock[];
    nextTs: number | undefined;
}

export interface EmSyncPassDeps {
    startCursor: number;
    maxIters: number;
    deadlineMs: number;
    now: () => number;
    fetchBlock: (cursor: number) => Promise<EmSyncRpcBlock | null>;
    bufferBlock: (nextDate: number, block: EmSyncRpcBlock) => Promise<boolean>;
    poolPressure: () => {waitingCount: number; usage: number};
    pausePct: number;
    caughtUpSlackS: number;
    interBatchMs: number;
    onYield?: () => void;
    onInvalid?: () => void;
}

// One catch-up pass: pull blocks, buffer them, advance in order. The I/O (RPC,
// buffer, pool pressure) is injected so the orchestration is testable.
export async function runEmSyncPass(
    deps: EmSyncPassDeps
): Promise<{lastGood: number | undefined; iters: number}> {
    let cursor = deps.startCursor;
    let lastGood: number | undefined;
    let iters = 0;
    while (iters < deps.maxIters && deps.now() < deps.deadlineMs) {
        if (iters > 0) {
            const p = deps.poolPressure();
            if (p.waitingCount > 0 || p.usage > deps.pausePct) {
                deps.onYield?.();
                break;
            }
        }
        iters++;
        const block = await deps.fetchBlock(cursor);
        if (block === null) {
            deps.onInvalid?.();
            break;
        }
        const nextDate = nextEmSyncCursor({
            nextTs: block.nextTs,
            data: block.data,
            lastSyncTs: cursor
        });
        const buffered = await deps.bufferBlock(nextDate, block);
        const step = emSyncPassDecision({
            buffered,
            nextDate,
            cursor,
            nextTs: block.nextTs,
            nowS: Math.floor(deps.now() / 1000),
            caughtUpSlackS: deps.caughtUpSlackS
        });
        if (step.bufferedOk) lastGood = nextDate;
        cursor = step.nextCursor;
        if (step.stop) break;
        if (deps.interBatchMs > 0) {
            await new Promise((r) => setTimeout(r, deps.interBatchMs));
        }
    }
    return {lastGood, iters};
}

export interface EmHandler {
    evaluate(m: ShellyMessageIncoming, device: ShellyDevice): void;
    seedFromDevices(devices: ReadonlyArray<ShellyDevice>): Promise<void>;
}

export const InitEm = (): EmHandler => {
    const syncQueue = new Map<
        string,
        {
            locked: boolean;
            id: number;
            syncProfile: SyncProfile;
            offlineSince?: number;
            lastAttemptTs?: number; // cadence — bumped at every sync() entry
            lastSyncedTs?: number; // real data ts — only on success
            syncJitter: number;
        }
    >();

    // Track in-flight syncs so a sync stuck longer than it should is visible
    // (monitor-only — no reclaim).
    let activeSyncs = 0;
    const STUCK_WARN_INTERVAL_MS = 30_000;
    const syncMonitor = new StuckMonitor('em_sync', STUCK_WARN_INTERVAL_MS, {
        now: () => Date.now(),
        setGauge: (name, value) => Observability.setGauge(name, value),
        warn: (message) => logger.warn(message),
        thresholdMs: () => tuning.rpc.emSyncStuckMs
    });
    const channelLags = new Map<
        string,
        {deviceId: string; channel: number; lagSeconds: number}
    >();

    function emSyncLagSnapshot() {
        let worst = {deviceId: '', channel: -1, lagSeconds: 0};
        let laggedChannels = 0;
        for (const entry of channelLags.values()) {
            if (entry.lagSeconds > 0) laggedChannels++;
            if (entry.lagSeconds > worst.lagSeconds) worst = entry;
        }
        return {worst, laggedChannels};
    }

    function recordEmSyncChannelLag(
        deviceId: string,
        channel: number,
        lagSeconds: number
    ): void {
        channelLags.set(`${deviceId}:${channel}`, {
            deviceId,
            channel,
            lagSeconds
        });
        const {worst, laggedChannels} = emSyncLagSnapshot();
        Observability.setGauge(
            'em_sync_worst_channel_lag_seconds',
            worst.lagSeconds
        );
        Observability.setGauge('em_sync_lagged_channels', laggedChannels);
    }

    Observability.registerModule('emSync', {
        stats: () => {
            const {worst, laggedChannels} = emSyncLagSnapshot();
            return {
                queueSize: syncQueue.size,
                activeSyncs,
                maxConcurrent: MAX_CONCURRENT_SYNCS,
                oldestHeldMs: syncMonitor.oldestHeldMs(),
                stuck: syncMonitor.stuckCount(),
                worstChannelLagSeconds: worst.lagSeconds,
                laggedChannels,
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
    type ChannelCursorMap = Map<number, Map<number, number>>;
    // Single batched read of every due device's per-channel cursor, replacing
    // the per-device + per-channel fn_last_sync round-trips on the hot path.
    // Returns null on failure so callers transparently fall back to per-device
    // reads (worst case = the pre-optimization behavior).
    const prefetchCursors = async (
        deviceIds: number[]
    ): Promise<ChannelCursorMap | null> => {
        if (deviceIds.length === 0) return new Map();
        try {
            const {rows} = await callMethod('device_em.fn_last_sync_batch', {
                p_devices: deviceIds
            });
            const map: ChannelCursorMap = new Map();
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

    let tickBusy = false;
    const syncTimer = setInterval(() => {
        void runSyncTick();
    }, TICK_INTERVAL_MS);
    syncTimer.unref?.();

    const runSyncTick = async (): Promise<void> => {
        // Re-entrancy guard: the batched cursor prefetch below is awaited, so a
        // slow prefetch must not let the next interval fire a second dispatch.
        if (tickBusy) return;
        syncMonitor.report();
        if (syncQueue.size === 0) return;
        // Lazy init — tuning is not available at module load time
        if (!emTuningInitialized) {
            MAX_CONCURRENT_SYNCS = tuning.rpc.maxConcurrentEmSyncs;
            emTuningInitialized = true;
        }

        const now = Math.floor(Date.now() / 1000);

        // Scan all devices — the in-memory check is just a Map lookup, costs nothing
        // Only dispatch up to MAX_CONCURRENT_SYNCS - activeSyncs new syncs
        const available = MAX_CONCURRENT_SYNCS - activeSyncs;
        if (available <= 0) return;

        // Load gate, evaluated once per tick: the fast "behind" cadence only
        // applies while the DB pool is healthy. When live work is queued for a
        // connection (or the pool is hot), every device reverts to the gentle
        // cadence so catch-up never competes with live ingestion.
        const pressure = getQueryPoolPressure();
        const poolBusy =
            pressure.waitingCount > 0 ||
            pressure.usage > CATCHUP_POOL_USAGE_PAUSE;

        // Collect the devices due this tick, then read ALL their sync cursors in
        // ONE batched query instead of 1+N per-channel fn_last_sync reads per
        // device. This is the connection-pressure fix: at MAX_CONCURRENT_SYNCS
        // the hot path used to hold dozens of DB connections just reading "where
        // did I leave off"; now it's a single prefetch per cycle.
        const due: {id: string; internalId: number}[] = [];
        for (const [id, entry] of syncQueue) {
            if (due.length >= available) break;
            if (entry.locked) continue;

            // Adaptive cadence: re-dispatch frequency scales with how far BEHIND
            // the device's data is. Far behind + pool healthy → near back-to-back
            // (drain fast); near real time (or pool busy) → gentle 9-min cadence.
            const lagS =
                entry.lastSyncedTs !== undefined
                    ? now - entry.lastSyncedTs
                    : Number.POSITIVE_INFINITY;
            const fast = !poolBusy && lagS > CATCHUP_BEHIND_LAG_S;
            const threshold = fast
                ? CATCHUP_BEHIND_CADENCE_S
                : SYNC_THRESHOLD_S + entry.syncJitter;

            // Gate on lastAttemptTs so failures can't busy-loop.
            const cadenceTs = entry.lastAttemptTs ?? entry.lastSyncedTs;
            if (cadenceTs !== undefined && now - cadenceTs < threshold) {
                continue;
            }

            due.push({id, internalId: entry.id});
        }
        if (due.length === 0) return;

        tickBusy = true;
        try {
            const cursorMap = await prefetchCursors(
                due.map((d) => d.internalId)
            );
            for (const {id} of due) {
                lockAndSync(id, cursorMap);
            }
        } finally {
            tickBusy = false;
        }
    };

    const lockAndSync = async (
        id: string,
        cursorMap?: ChannelCursorMap | null
    ) => {
        activeSyncs++;
        syncMonitor.begin(id);
        try {
            if (await lock(id)) {
                await sync(id, cursorMap);
            }
        } catch (e) {
            logger.warn(`EM sync error for ${id}: ${e}`);
            Observability.incrementCounter('em_syncs_failed');
            // Ensure unlock on unexpected errors
            try {
                unlock(id);
            } catch (_) {
                /* already unlocked or removed */
            }
        } finally {
            activeSyncs--;
            syncMonitor.end(id);
        }
    };

    const lock = async (id: string): Promise<boolean> => {
        const sd = syncQueue.get(id);
        if (sd && sd.locked === true) {
            return false;
        }
        if (!sd?.id) {
            throw new Error('InternalIdIsRequired');
        }
        sd.locked = true;
        syncQueue.set(id, sd);
        return true;
    };
    const unlock = (id: string): void => {
        const sd = syncQueue.get(id);
        if (!sd?.id) {
            throw new Error('InternalIdIsRequired');
        }
        sd.locked = false;
        syncQueue.set(id, sd);
    };
    const addForSync = async (device: string, syncProfile: SyncProfile) => {
        if (!syncQueue.get(device)) {
            const [r] = await get(device);
            // Load last sync timestamp from DB so we don't re-query it every tick.
            // Empty rows = first sync, which is fine. A thrown error here is a
            // real DB problem (pool, missing function) and must surface — the
            // bare catch used to mask it and re-sync from epoch every tick.
            let lastSyncedTs: number | undefined;
            try {
                const {rows} = await callMethod('device_em.fn_last_sync', {
                    p_device: r.id,
                    p_channel: -1
                });
                if (rows.length > 0) {
                    lastSyncedTs = rows[0].created;
                }
            } catch (err) {
                logger.warn(
                    'fn_last_sync probe failed device=%s; treating as first sync: %s',
                    device,
                    err
                );
            }
            syncQueue.set(device, {
                locked: false,
                id: r.id,
                syncProfile,
                lastSyncedTs,
                syncJitter: Math.floor(Math.random() * 60)
            });
        }
    };
    const appendMeasurements = async ({
        fields,
        device,
        channel,
        payload,
        syncCursor
    }: {
        fields: MeasurementField[];
        device: number;
        channel: number;
        payload: {
            keys: string[];
            data: {
                period: number;
                ts: number;
                values: number[][];
            }[];
        };
        syncCursor: EmSyncCursor;
    }): Promise<boolean> => {
        if (!payload) {
            return false;
        }
        if (Observability.isDbWritesDisabled()) {
            Observability.incrementCounter('em_sync_writes_skipped');
            return false;
        }
        const inserts = buildEmStatsBatch({fields, payload, device, channel});
        // Buffer the block; the drainer writes raw rows + bookmark atomically.
        // false => not buffered (rate-limited / error): caller stops the pass so
        // the bookmark never advances past an undelivered block.
        return enqueueEmSyncBlock({rows: inserts, cursor: syncCursor});
    };

    interface SyncChannelInput {
        deviceId: number;
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
    }

    // Returns the nextDate ts on success, undefined on any skip/failure.
    const syncOneChannel = async (
        input: SyncChannelInput
    ): Promise<number | undefined> => {
        const {deviceId, shellyDev, channel, method, fields} = input;
        const timer = new StageTimer();
        try {
            // Resolve the start cursor. Fast path: use the per-cycle batched
            // prefetch (no DB hit here). Fallback path (prefetch failed): the
            // original per-channel fn_last_sync read, preserved verbatim so a
            // prefetch failure degrades to today's exact behavior.
            let cursor: number;
            if (input.prefetched) {
                if (input.prefetchedCursor === undefined) {
                    Observability.incrementCounter('em_syncs_skipped_no_data');
                    return undefined;
                }
                cursor = input.prefetchedCursor;
            } else {
                const lastSyncResult = await callMethod(
                    'device_em.fn_last_sync',
                    {p_device: deviceId, p_channel: channel}
                );
                timer.mark('last_sync');
                if (!lastSyncResult?.rows?.[0]?.created) {
                    logger.warn(
                        `EM Sync: no last_sync row for device=${deviceId} channel=${channel}, skipping`
                    );
                    Observability.incrementCounter('em_syncs_skipped_no_data');
                    return undefined;
                }
                cursor = Number.parseInt(lastSyncResult.rows[0].created, 10);
            }
            recordEmSyncChannelLag(
                String(deviceId),
                channel,
                Math.max(0, Math.floor(Date.now() / 1000) - cursor)
            );
            // Drain the backlog this pass, lower-priority than live work.
            const {lastGood, iters} = await runEmSyncPass({
                startCursor: cursor,
                maxIters: catchupAllowed(deviceId) ? CATCHUP_MAX_ITERS : 1,
                deadlineMs: Date.now() + CATCHUP_MAX_MS,
                now: () => Date.now(),
                pausePct: CATCHUP_POOL_USAGE_PAUSE,
                caughtUpSlackS: CATCHUP_CAUGHTUP_SLACK_S,
                interBatchMs: CATCHUP_INTER_BATCH_MS,
                poolPressure: getQueryPoolPressure,
                onYield: () =>
                    Observability.incrementCounter('em_sync_catchup_yielded'),
                onInvalid: () => {
                    logger.warn(
                        `EM Sync: invalid RPC response for device=${deviceId} channel=${channel}`
                    );
                    Observability.incrementCounter('em_syncs_skipped_no_data');
                },
                fetchBlock: async (c) => {
                    const rpcStarted = Date.now();
                    const rpcResult = await shellyDev.sendRPC(method, {
                        id: channel,
                        ts: c
                    });
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
                    return {keys, data, nextTs};
                },
                // If a block isn't buffered, runEmSyncPass stops the pass so the
                // bookmark never moves past an undelivered block.
                bufferBlock: (nextDate, block) =>
                    appendMeasurements({
                        fields,
                        device: deviceId,
                        channel,
                        payload: {keys: block.keys, data: block.data},
                        syncCursor: {
                            device: deviceId,
                            created: nextDate,
                            channel
                        }
                    })
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
            return lastGood;
        } catch (err) {
            // Per-channel failure isolation — siblings still complete.
            Observability.incrementCounter('em_syncs_channel_failed');
            logger.warn(
                `EM Sync: channel failed device=${deviceId} channel=${channel}: ${err}`
            );
            return undefined;
        }
    };

    // Latest ts only if EVERY channel succeeded — partial success leaves
    // lastSyncedTs untouched so the next tick retries from the prior point.
    const latestSuccessfulTs = (
        results: ReadonlyArray<number | undefined>
    ): number | undefined => {
        if (results.some((r) => r === undefined)) return undefined;
        return Math.max(...(results as number[]));
    };

    const sync = async (
        shellyId: string,
        cursorMap?: ChannelCursorMap | null
    ): Promise<any> => {
        const device = syncQueue.get(shellyId);
        const id = device?.id;
        if (!id) {
            return;
        }

        // Single retry-cadence bump for every code path below.
        device.lastAttemptTs = Math.floor(Date.now() / 1000);

        // Check online FIRST — before any DB calls
        const shellyDev = DeviceCollector.getDevice(shellyId) as
            | ShellyDevice
            | undefined;
        if (!shellyDev) {
            // Device fully deleted — remove immediately (no unlock needed, entry is gone)
            syncQueue.delete(shellyId);
            logger.info(
                `EM Sync: removed deleted device ${id} from sync queue`
            );
            return;
        }
        if (!shellyDev.online) {
            // Device offline — apply grace period
            if (!device.offlineSince) {
                device.offlineSince = Date.now();
            }
            if (Date.now() - device.offlineSince > EM_SYNC_GRACE_PERIOD_MS) {
                syncQueue.delete(shellyId);
                logger.info(
                    `EM Sync: removed device ${id} after ${EM_SYNC_GRACE_PERIOD_MS / 1000}s offline`
                );
            } else {
                Observability.incrementCounter('em_syncs_skipped_offline');
                unlock(shellyId);
            }
            return;
        }

        // Device is online — reset offline timer
        device.offlineSince = undefined;

        logger.info(`EM Sync started for device: ${id}`);
        try {
            const params = device.syncProfile;
            const channels = params.channels || [];
            // Device-level cursor: derive from the once-per-cycle batched
            // prefetch when present (no DB hit); otherwise fall back to the
            // per-device fn_last_sync read (prefetch failed / not supplied).
            const chCursors = cursorMap ? cursorMap.get(id) : undefined;
            let lastTx: {created: number}[];
            if (cursorMap) {
                const vals = chCursors ? [...chCursors.values()] : [];
                lastTx = vals.length ? [{created: Math.max(...vals)}] : [];
            } else {
                ({rows: lastTx} = await callMethod('device_em.fn_last_sync', {
                    p_device: id,
                    p_channel: -1
                }));
            }
            if (!lastTx.length) {
                const ts = day0();
                await Promise.all(
                    channels.map(async (ch) => {
                        logger.info(
                            `Pushing zero day! for id: ${id}, channel: ${ch}, ts: ${ts}`
                        );
                        if (Observability.isDbWritesDisabled()) {
                            Observability.incrementCounter(
                                'em_sync_writes_skipped'
                            );
                        } else {
                            return await callMethod('device_em.fn_synced', {
                                p_device: id,
                                p_created: ts,
                                p_channel: ch
                            });
                        }
                    })
                );
                // Cache the zero-day timestamp
                if (device) device.lastSyncedTs = ts;
                return;
            }
            const [{created}] = lastTx;
            if (!inPast(created)) {
                // Cache the timestamp in memory so next tick skips the DB check
                if (device) device.lastSyncedTs = created;
                logger.info(
                    `Device: ${id} last record(${created}) is not in the past`
                );
                return;
            }
            const fields = measurementFields(params?.phases);
            // Channels run in parallel — each is an independent device RPC
            // round-trip + DB batch. Per-channel errors don't sink the others.
            const channelResults = await Promise.all(
                channels.map((channel) =>
                    syncOneChannel({
                        deviceId: id,
                        shellyDev,
                        channel,
                        method: params.method,
                        fields,
                        prefetched: !!cursorMap,
                        prefetchedCursor: chCursors?.get(channel)
                    })
                )
            );
            // Cache latest ts only on full success across every channel.
            const latestSyncTs = latestSuccessfulTs(channelResults);
            if (device && latestSyncTs !== undefined) {
                device.lastSyncedTs = latestSyncTs;
            }
        } catch (e) {
            logger.warn(e);
            logger.warn(`Sync error for device: ${id}`);
        } finally {
            logger.info(`Sync finished for device: ${id}`);
            Observability.incrementCounter('em_syncs_completed');
            unlock(shellyId);
        }
    };
    const o = {
        evaluate(_m: ShellyMessageIncoming, device: ShellyDevice): void {
            (async () => {
                const profile = detectSyncProfile(device);
                if (!profile) return;
                await addForSync(device.shellyID, profile);
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
                    shellyID: device.shellyID,
                    profile: detectSyncProfile(device)
                }))
                .filter((t) => t.profile !== null);
            await runBoundedParallel({
                tasks: targets,
                run: (t) => addForSync(t.shellyID, t.profile!),
                concurrency: BOOT_SEED_CONCURRENCY,
                perTaskTimeoutMs: BOOT_SEED_TASK_TIMEOUT_MS,
                label: 'em-boot-seed'
            });
            Observability.incrementCounter(
                'em_syncs_seeded_at_boot',
                targets.length
            );
            logger.info(`EM Sync: seeded ${targets.length} device(s) at boot`);
        }
    };
    return o;
};
