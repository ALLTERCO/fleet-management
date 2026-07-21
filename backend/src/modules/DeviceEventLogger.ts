// Durable journal of device-reported changes. The PathChange deltas FM already
// computes on every NotifyStatus (component/field/prev->next) are captured here
// instead of being discarded, then batch-flushed to device.event_log. Mirrors
// AuditLogger: BoundedQueue (drop-oldest, counter) + periodic batch flush.
// Lossless within the hard cap — sized to absorb a 2k-device burst; the device
// timestamp is preserved verbatim.

import * as log4js from 'log4js';
import {tuning} from '../config/tuning';
import type AbstractDevice from '../model/AbstractDevice';
import type {PathChange} from '../types';
import {BoundedQueue} from './boundedQueue';
import {
    appendDeviceEventEntries,
    appendDeviceEventEntriesBestEffort
} from './deviceEvents/DeviceEventStream';
import {
    changesToEntries,
    type DeviceEventEntry,
    entryToBatchRow,
    epochSecToIso
} from './deviceEvents/deviceEventRow';
import {type LiveChange, toLiveChange} from './deviceEvents/liveChange';
import {writeDeviceEventRowBatch} from './deviceEvents/writeDeviceEventRow';
import {getDeviceOrg, notifyAll} from './EventDistributor';
import * as Observability from './Observability';

const logger = log4js.getLogger('device-events');

interface QueuedEntry extends DeviceEventEntry {
    _retryCount?: number;
}

// Lazy so importing the module is side-effect free. tuning is read on first
// use, not at import time — tests that reload tuning see the updated cap.
let queueInstance: BoundedQueue<QueuedEntry> | null = null;
function getQueue(): BoundedQueue<QueuedEntry> {
    if (queueInstance) return queueInstance;
    queueInstance = new BoundedQueue<QueuedEntry>({
        maxSize: tuning.deviceEvents.queueHardMax,
        overflow: 'drop-oldest',
        onDrop: () => Observability.incrementCounter('device_event_evicted')
    });
    return queueInstance;
}

let inFlightFlush: Promise<void> | null = null;
const pendingStreamAppends = new Set<Promise<void>>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

export function startFlushTimer(): void {
    if (flushTimer) return;
    flushTimer = setInterval(flushQueue, tuning.deviceEvents.flushIntervalMs);
    flushTimer.unref?.();
}

export function stopFlushTimer(): void {
    if (!flushTimer) return;
    clearInterval(flushTimer);
    flushTimer = null;
}

function recordUnarmedIfAny(): void {
    if (flushTimer) return;
    Observability.incrementCounter('device_event_unarmed_calls');
}

// Whole batch failed — requeue with a retry budget so a transient DB blip
// doesn't lose changes, but a permanently poisoned batch can't loop forever.
function requeueFailed(entries: QueuedEntry[]): void {
    Observability.incrementCounter('device_event_write_errors');
    const queue = getQueue();
    for (const entry of entries) {
        const attempts = (entry._retryCount ?? 0) + 1;
        if (attempts >= tuning.deviceEvents.maxRetries) {
            Observability.incrementCounter('device_event_write_dropped');
            continue;
        }
        queue.push({...entry, _retryCount: attempts});
    }
}

async function flushQueueOnce(): Promise<void> {
    const queue = getQueue();
    if (queue.size === 0) return;

    if (Observability.isDbWritesDisabled()) {
        // Hold the queue until writes re-enable; BoundedQueue caps memory.
        Observability.incrementCounter('device_event_flushes_skipped');
        return;
    }

    Observability.incrementCounter('device_event_flushes');
    const entries = queue.drain();
    const start = performance.now();
    try {
        await writeDeviceEventRowBatch(entries.map(entryToBatchRow));
    } catch (err) {
        logger.warn(
            'device event batch flush failed (%d rows): %s',
            entries.length,
            err
        );
        requeueFailed(entries);
    } finally {
        Observability.recordDbTiming(
            'device_event_flush',
            performance.now() - start
        );
    }
}

function flushQueue(): Promise<void> {
    if (inFlightFlush) return inFlightFlush;
    inFlightFlush = flushQueueOnce().finally(() => {
        inFlightFlush = null;
    });
    return inFlightFlush;
}

function stampEntry(entry: DeviceEventEntry): DeviceEventEntry {
    // Stamp NOW() only when the device gave no timestamp — never overwrite it.
    return entry.ts ? entry : {...entry, ts: new Date().toISOString()};
}

function pushToQueue(entry: DeviceEventEntry): void {
    recordUnarmedIfAny();
    const queue = getQueue();
    queue.push(entry);
    if (queue.size >= tuning.deviceEvents.queueMax && !inFlightFlush) {
        void flushQueue();
    }
}

export interface CaptureInput {
    /** Source device — supplies the id, the live-event scope, and the
     *  permission boundary for delivery. */
    device: AbstractDevice;
    /** Device-reported time (Unix epoch seconds). Preserved verbatim. */
    tsEpochSec?: number;
    changes: readonly PathChange[];
}

// Persist every entry (never coalesced — one row each) and broadcast the same
// rows live. One home for both the status-delta and device-event capture.
function record(device: AbstractDevice, entries: DeviceEventEntry[]): void {
    if (entries.length === 0) return;
    const stamped = entries.map(stampEntry);
    Observability.incrementCounter('device_event_entries', stamped.length);

    if (tuning.deviceEvents.redisFirst) {
        let pending: Promise<void>;
        pending = appendDeviceEventEntries(stamped)
            .catch((err) => {
                Observability.incrementCounter(
                    'device_event_stream_append_errors'
                );
                logger.error('device-event Redis-first append failed: %s', err);
                for (const entry of stamped) pushToQueue(entry);
            })
            .finally(() => pendingStreamAppends.delete(pending));
        pendingStreamAppends.add(pending);
        emitDeviceChange(device, entries);
        return;
    }
    if (tuning.deviceEvents.redisShadow) {
        void appendDeviceEventEntriesBestEffort(stamped);
    }

    for (const entry of stamped) pushToQueue(entry);
    emitDeviceChange(device, entries);
}

// One call per NotifyStatus: the leaf changes FM computed at the merge boundary.
export function captureChanges(input: CaptureInput): void {
    const shellyId = input.device.shellyID;
    record(
        input.device,
        changesToEntries({
            deviceId: input.device.id,
            shellyId,
            organizationId: getDeviceOrg(shellyId),
            tsEpochSec: input.tsEpochSec,
            changes: input.changes
        })
    );
}

export interface DeviceEventInput {
    device: AbstractDevice;
    /** Component that raised the event, e.g. "input:0". */
    component: string;
    /** Event name, e.g. "single_push" — stored in the field column. */
    event: string;
    /** Optional event payload (Shelly events may carry data). */
    data?: unknown;
    /** Device-reported time (Unix epoch seconds). Preserved verbatim. */
    tsEpochSec?: number;
}

// One call per device-reported event (button push, config_changed, ...). An
// event is a point in time, not a transition — prev is null, the payload (if
// any) is next, kind is 'event'.
export function captureDeviceEvent(input: DeviceEventInput): void {
    const shellyId = input.device.shellyID;
    record(input.device, [
        {
            ts: epochSecToIso(input.tsEpochSec),
            deviceId: input.device.id,
            shellyId,
            organizationId: getDeviceOrg(shellyId),
            component: input.component,
            field: input.event,
            prev: null,
            next: input.data ?? null,
            kind: 'event',
            source: 'device'
        }
    ]);
}

// Live fan-out of the DeviceEvent.Change event. eventData.device scopes
// delivery to subscribers who declared this device and pass the per-device
// access check; subscribers receive the same prev->next deltas we persist.
// Fire-and-forget — the hot path must not await delivery, and notifyAll
// early-returns when no console is watching. One event per message carries all
// of its deltas as an array, so no change is dropped or merged.
function emitDeviceChange(
    device: AbstractDevice,
    entries: DeviceEventEntry[]
): void {
    const changes: LiveChange[] = entries.map(toLiveChange);
    void notifyAll(
        {
            method: 'DeviceEvent.Change',
            params: {shellyId: device.shellyID, changes}
        },
        {device}
    );
}

export async function flush(): Promise<void> {
    while (true) {
        const pending = [...pendingStreamAppends];
        if (pending.length > 0) await Promise.all(pending);
        await flushQueue();
        if (pendingStreamAppends.size === 0 && getQueue().size === 0) return;
    }
}

Observability.registerModule('deviceEvents', {
    stats: () => ({
        queueLength: getQueue().size,
        pendingStreamAppends: pendingStreamAppends.size,
        redisFirst: tuning.deviceEvents.redisFirst,
        redisShadow: tuning.deviceEvents.redisShadow
    }),
    topology: {
        role: 'transform',
        cluster: 'storage',
        upstreams: ['statusQueue'],
        downstreams: ['dbPool'],
        label: 'Device Event Log',
        description: 'Device-reported change journal',
        route: '/monitoring/device-events'
    }
});
